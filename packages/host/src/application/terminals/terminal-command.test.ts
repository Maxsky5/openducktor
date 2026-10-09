import { afterAll, describe, expect, test } from "bun:test";
import type {
  TerminalActivityMessage,
  TerminalOwnedContext,
  TerminalStartedBy,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { TerminalPtyError } from "../../ports/terminal-pty-port";
import type { TerminalCommandLines, TerminalCommandRequest } from "./terminal-command";
import { createTerminalService } from "./terminal-service";
import { TerminalServiceError } from "./terminal-service-error";
import {
  filesystem,
  makePty,
  makeService,
  removeFakeShell,
  workspaceTerminalDependencies,
} from "./test-support/terminal-service-harness";

afterAll(removeFakeShell);

const decode = (data: Uint8Array): string => new TextDecoder().decode(data);

const waitForLaunches = async (pty: ReturnType<typeof makePty>, count: number) => {
  for (let attempt = 0; attempt < 200 && pty.launches.length < count; attempt += 1) {
    await Bun.sleep(5);
  }
  expect(pty.launches).toHaveLength(count);
};

const commandRequest = (
  label: string,
  commandLines: TerminalCommandLines,
  context: TerminalOwnedContext = { repoPath: "/repo", taskId: "task-1" },
  startedBy: TerminalStartedBy = "user",
): TerminalCommandRequest => ({
  context,
  workingDir: "/repo",
  label,
  commandLines,
  startedBy,
});

describe("TerminalService command terminals", () => {
  test("runs the command lines in one process, then continues in a normal shell under the label", async () => {
    const { service, pty, settleTitles } = await makeService();
    const output: string[] = [];
    const messages: TerminalActivityMessage[] = [];
    const stop = await Effect.runPromise(
      service.observeActivity((message) => messages.push(message)),
    );
    try {
      const { response } = await Effect.runPromise(
        service.startCommand(commandRequest("Checks", ["bun install", "bun test"])),
      );
      expect(response.summary).toMatchObject({
        label: "Checks",
        lifecycle: "running",
        startedBy: "user",
      });
      const [commandLaunch] = pty.launches;
      expect(commandLaunch).toMatchObject({
        cwd: response.summary.initialWorkingDir,
        runsCommand: true,
      });
      expect(commandLaunch?.args[0]).toBe("-ilc");
      expect(commandLaunch?.args[1]?.split("\n").filter((line) => line.startsWith("bun "))).toEqual(
        ["bun install", "bun test"],
      );
      expect(commandLaunch?.commandNonce).toBeUndefined();
      expect(messages.at(-1)).toMatchObject({
        type: "activity_updated",
        activity: { command: "bun install; bun test", summary: { label: "Checks" } },
      });

      await Effect.runPromise(
        service.attach({
          terminalId: response.ref.terminalId,
          attachmentId: "attachment-1",
          lastConsumedSequence: 0,
          sink: (event, payload) => {
            if (event.type === "output") output.push(decode(payload));
          },
        }),
      );
      expect(output.join("")).toContain("$ bun install");
      expect(output.join("")).toContain("$ bun test");

      pty.emit(new TextEncoder().encode("\u001b]0;vitest\u0007tests failed\r\n"));
      settleTitles();
      pty.exit(1);
      await waitForLaunches(pty, 2);
      const shellLaunch = pty.launches[1];
      expect(shellLaunch).toMatchObject({ args: ["-l"], cwd: response.summary.initialWorkingDir });
      expect(shellLaunch?.runsCommand).toBeUndefined();
      expect(shellLaunch?.commandNonce).toBeString();
      expect(messages.at(-1)).toMatchObject({
        type: "activity_removed",
        terminalId: response.ref.terminalId,
      });

      pty.emit(new TextEncoder().encode("$ "));
      const [listed] = (await Effect.runPromise(service.list({ kind: "all" }))).terminals;
      expect(listed).toMatchObject({ label: "Checks", lifecycle: "running", exit: null });
      await Effect.runPromise(service.write(response.ref.terminalId, new Uint8Array([3])));
      expect(pty.operations).toContain("write:\u0003");
    } finally {
      stop();
      await Effect.runPromise(service.dispose());
    }
  });

  test("keeps a host-started terminal usable as a shell after its command", async () => {
    const { service, pty } = await makeService();
    const started = await Effect.runPromise(
      service.startCommandInPreparedTarget(
        commandRequest("Install", ["bun install"], undefined, "host"),
      ),
    );
    pty.emit(new TextEncoder().encode("done\r\n"));
    pty.exit(0);

    expect(await Effect.runPromise(started.result)).toEqual({
      type: "exited",
      exitCode: 0,
      signal: null,
      outputTail: ["$ bun install", "done"],
    });
    await waitForLaunches(pty, 2);
    const [listed] = (await Effect.runPromise(service.list({ kind: "all" }))).terminals;
    expect(listed).toMatchObject({ label: "Install", lifecycle: "running", startedBy: "host" });
    await Effect.runPromise(
      service.write(started.response.ref.terminalId, new TextEncoder().encode("ls\r")),
    );
    expect(pty.operations).toContain("write:ls\r");
    await Effect.runPromise(service.dispose());
  });

  test("reports the command result with its output tail before the shell starts", async () => {
    const { service, pty } = await makeService();
    const started = await Effect.runPromise(
      service.startCommandInPreparedTarget(commandRequest("Install", ["bun install"])),
    );
    pty.emit(new TextEncoder().encode("resolving\r\nerror: lockfile mismatch\r\n"));
    pty.exit(2);
    expect(await Effect.runPromise(started.result)).toEqual({
      type: "exited",
      exitCode: 2,
      signal: null,
      outputTail: ["$ bun install", "resolving", "error: lockfile mismatch"],
    });
    await waitForLaunches(pty, 2);
    await Effect.runPromise(service.dispose());
  });

  test("reports a closed or failed command with the reason and the output tail", async () => {
    const pty = makePty(true, false);
    let id = 0;
    const { service } = await makeService(pty, () => `terminal-${++id}`);
    const start = (label: string) =>
      Effect.runPromise(
        service.startCommandInPreparedTarget(commandRequest(label, ["bun install"])),
      );

    const closed = await start("Closed");
    pty.emit(new TextEncoder().encode("resolving packages\r\n"));
    await Effect.runPromise(
      service.close({ terminalId: closed.response.ref.terminalId, confirmTerminate: true }),
    );
    expect(await Effect.runPromise(closed.result)).toEqual({
      type: "closed",
      outputTail: ["$ bun install", "resolving packages"],
    });

    const failed = await start("Failed");
    pty.emit(new TextEncoder().encode("linking\r\n"));
    pty.fail(
      new TerminalPtyError({
        code: "operation_failed",
        operation: "terminate",
        message: "node-pty process-tree termination failed.",
      }),
    );
    expect(await Effect.runPromise(failed.result)).toEqual({
      type: "failed",
      message: "node-pty process-tree termination failed.",
      outputTail: ["$ bun install", "linking"],
    });
    await Effect.runPromise(service.dispose());
  });

  test("returns the launch environment failure when the login shell cannot run commands", async () => {
    const pty = makePty();
    const targets = workspaceTerminalDependencies(new Map());
    const unsupported = new TerminalServiceError({
      code: "unsupported_shell",
      operation: "start_command",
      message: "Commands cannot run in the login shell /usr/bin/nu.",
    });
    const service = await Effect.runPromise(
      createTerminalService({
        filesystem,
        git: targets.git,
        taskWorktrees: { getTaskWorktree: () => Effect.succeed(null) },
        workspaceSessions: { settings: targets.settings, store: targets.store },
        ptyPort: pty.port,
        launchEnvironment: {
          shell: () => Effect.succeed({ shell: "/usr/bin/nu", args: [], env: {} }),
          command: () => Effect.fail(unsupported),
        },
      }),
    );
    const result = await Effect.runPromise(
      Effect.result(
        service.startCommandInPreparedTarget(commandRequest("Install", ["bun install"])),
      ),
    );

    expect(result._tag === "Failure" && result.failure).toBe(unsupported);
    expect(pty.launches).toEqual([]);
  });

  test("validates the chat owner, unless the caller prepared the target", async () => {
    const { service, pty } = await makeService();
    const chat: TerminalOwnedContext = {
      kind: "workspace_session",
      workspaceId: "workspace-1",
      sessionId: "new-chat",
      repoPath: "/repo",
    };
    const request = commandRequest("Install", ["bun install"], chat);

    const rejected = await Effect.runPromise(Effect.result(service.startCommand(request)));
    expect(rejected._tag === "Failure" && rejected.failure.code).toBe(
      "workspace_session_unavailable",
    );
    expect(pty.launches).toEqual([]);

    const started = await Effect.runPromise(service.startCommandInPreparedTarget(request));
    expect(started.response.summary.context).toEqual(chat);
    await Effect.runPromise(service.dispose());
  });

  test("requires confirmation to close a running command and reports a closed result", async () => {
    const { service, pty } = await makeService(makePty(true, false));
    const started = await Effect.runPromise(
      service.startCommandInPreparedTarget(commandRequest("Dev", ["bun run dev"])),
    );
    const terminalId = started.response.ref.terminalId;
    const unconfirmed = await Effect.runPromise(
      Effect.result(service.close({ terminalId, confirmTerminate: false })),
    );
    expect(unconfirmed._tag === "Failure" && unconfirmed.failure.code).toBe(
      "confirmation_required",
    );
    expect(pty.operations).not.toContain("inspect-children");

    await Effect.runPromise(service.close({ terminalId, confirmTerminate: true }));
    expect(await Effect.runPromise(started.result)).toEqual({
      type: "closed",
      outputTail: ["$ bun run dev"],
    });
    expect(pty.launches).toHaveLength(1);
    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
  });

  test("reports an active command phase to workspace activity checks", async () => {
    const { service } = await makeService(makePty(true, false));
    const started = await Effect.runPromise(
      service.startCommandInPreparedTarget(
        commandRequest("Dev", ["bun run dev"], {
          repoPath: "/canonical/repo",
          taskId: "task-1",
        }),
      ),
    );
    expect(await Effect.runPromise(service.inspectWorkspaceActivity("/canonical/repo"))).toEqual({
      activeTerminalIds: [started.response.ref.terminalId],
      unknownTerminalIds: [],
    });
    await Effect.runPromise(service.dispose());
  });

  test("starts the shell at the latest terminal grid", async () => {
    const { service, pty } = await makeService();
    const started = await Effect.runPromise(
      service.startCommandInPreparedTarget(commandRequest("Build", ["bun run build"])),
    );
    await Effect.runPromise(
      service.resize(started.response.ref.terminalId, { columns: 132, rows: 40 }),
    );
    pty.exit(0);
    await waitForLaunches(pty, 2);
    expect(pty.launches[1]?.grid).toEqual({ columns: 132, rows: 40 });
    await Effect.runPromise(service.dispose());
  });

  test("sends resize and input during the command-to-shell handoff to the new shell", async () => {
    const pty = makePty();
    const handleInputs: string[][] = [];
    const start = pty.port.start;
    pty.port.start = (plan, handlers) =>
      start(plan, handlers).pipe(
        Effect.map((handle) => {
          const inputs: string[] = [];
          handleInputs.push(inputs);
          return {
            ...handle,
            write: (data: Uint8Array) => {
              inputs.push(decode(data));
              return handle.write(data);
            },
            resize: (grid: { columns: number; rows: number }) => {
              inputs.push(`resize:${grid.columns}x${grid.rows}`);
              return handle.resize(grid);
            },
          };
        }),
      );
    const { service } = await makeService(pty);
    const started = await Effect.runPromise(
      service.startCommandInPreparedTarget(commandRequest("Build", ["bun run build"])),
    );
    const terminalId = started.response.ref.terminalId;
    pty.exit(0);
    await Promise.all([
      Effect.runPromise(service.resize(terminalId, { columns: 132, rows: 40 })),
      Effect.runPromise(service.write(terminalId, new TextEncoder().encode("ls\r"))),
    ]);

    expect(handleInputs).toEqual([[], ["resize:132x40", "ls\r"]]);
    await Effect.runPromise(service.dispose());
  });
});
