import { beforeEach, describe, expect, test } from "bun:test";
import { posix } from "node:path";
import { Effect } from "effect";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import type { FilesystemPort } from "../../ports/filesystem-port";
import {
  TerminalPtyError,
  type TerminalPtyHandlers,
  type TerminalPtyPort,
} from "../../ports/terminal-pty-port";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { createTerminalService } from "./terminal-service";

let directoryAvailable = true;
const filesystem: FilesystemPort = {
  homeDirectory: () => "/home/user",
  canonicalize: (path: string) => Effect.succeed(`/canonical${path}`),
  readDirectory: () => Effect.succeed([]),
  readFileBytes: () => Effect.succeed(new Uint8Array()),
  stat: () => Effect.succeed({ isDirectory: directoryAvailable }),
  exists: () => Effect.succeed(true),
  join: posix.join,
  relative: posix.relative,
  parent: (path) => (path === "/" ? null : posix.dirname(path)),
};

const makePty = (supportsOutputPause = true, hasChildProcesses = true) => {
  const operations: string[] = [];
  let handlers: TerminalPtyHandlers | null = null;
  let terminateFails = false;
  let terminateFailuresRemaining = 0;
  const port: TerminalPtyPort = {
    start: (_plan, nextHandlers) => {
      handlers = nextHandlers;
      return Effect.succeed({
        supportsOutputPause,
        hasChildProcesses: () =>
          Effect.sync(() => {
            operations.push("inspect-children");
            return hasChildProcesses;
          }),
        write: (data) =>
          Effect.sync(() => operations.push(`write:${new TextDecoder().decode(data)}`)),
        resize: (grid) => Effect.sync(() => operations.push(`resize:${grid.columns}x${grid.rows}`)),
        pauseOutput: () => Effect.sync(() => operations.push("pause")),
        resumeOutput: () => Effect.sync(() => operations.push("resume")),
        terminate: () =>
          Effect.suspend(() => {
            if (terminateFails || terminateFailuresRemaining > 0) {
              if (terminateFailuresRemaining > 0) terminateFailuresRemaining -= 1;
              return Effect.fail(
                new TerminalPtyError({
                  code: "operation_failed",
                  operation: "terminate",
                  message: "busy",
                }),
              );
            }
            return Effect.sync(() => operations.push("terminate"));
          }),
      });
    },
  };
  return {
    port,
    operations,
    emit: (data: Uint8Array) => handlers?.onOutput(data),
    exit: (exitCode: number | null = 0) => handlers?.onExit({ exitCode, signal: null }),
    failTerminate: () => {
      terminateFails = true;
    },
    failNextTerminate: () => {
      terminateFailuresRemaining += 1;
    },
  };
};

const makeService = async (pty = makePty(), idFactory: () => string = () => "terminal-1") => ({
  pty,
  service: await Effect.runPromise(
    createTerminalService({
      filesystem,
      ptyPort: pty.port,
      resolveLaunchEnvironment: createTerminalLaunchEnvironment({
        processEnv: { SHELL: "/bin/zsh", PATH: "/usr/bin" },
        platform: "darwin",
      }),
      idFactory,
      hostInstanceIdFactory: () => "host-1",
      now: () => new Date("2026-07-12T00:00:00.000Z"),
    }),
  ),
});

describe("TerminalService", () => {
  beforeEach(() => {
    directoryAvailable = true;
  });
  test("creates a taskless terminal and keeps its canonical initial directory immutable", async () => {
    const { service, pty } = await makeService();
    const created = await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      service.write(created.ref.terminalId, new TextEncoder().encode("cd /tmp\n")),
    );
    const listed = await Effect.runPromise(service.list({ kind: "unassociated" }));
    expect(listed.terminals[0]?.initialWorkingDir).toBe("/canonical/repo");
    expect(pty.operations).toContain("write:cd /tmp\n");
  });

  test("publishes output before exit with monotonic byte ranges", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: { taskId: "task-1" } }));
    const events: Array<{ type: string; start?: number; end?: number }> = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => {
          if (event.type === "output") {
            events.push({ type: event.type, start: event.sequenceStart, end: event.sequenceEnd });
            return;
          }
          events.push({ type: event.type });
        },
      }),
    );
    pty.emit(new Uint8Array([1, 2]));
    pty.emit(new Uint8Array([3]));
    pty.exit(7);
    expect(events.filter((event) => event.type === "output")).toEqual([
      { type: "output", start: 0, end: 2 },
      { type: "output", start: 2, end: 3 },
    ]);
    expect(events.at(-1)?.type).toBe("lifecycle");
  });

  test("preserves input and resize barriers", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      Effect.all(
        [
          service.write("terminal-1", new TextEncoder().encode("first")),
          service.resize("terminal-1", { columns: 120, rows: 40 }),
          service.write("terminal-1", new TextEncoder().encode("second")),
        ],
        { concurrency: "unbounded" },
      ),
    );
    expect(pty.operations).toEqual(["write:first", "resize:120x40", "write:second"]);
  });

  test("reports an exact replay gap before the retained tail", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.emit(new Uint8Array(TERMINAL_LIMITS.replayBytes + 1));
    const eventTypes: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "attachment-1",
        lastConsumedSequence: 0,
        sink: (event) => eventTypes.push(event.type),
      }),
    );
    expect(eventTypes[0]).toBe("snapshot");
    expect(eventTypes[1]).toBe("replay_gap");
    expect(eventTypes[2]).toBe("output");
  });

  test("rejects an attachment position beyond published output", async () => {
    const { service } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await expect(
      Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: "future",
          lastConsumedSequence: 1,
          sink: () => undefined,
        }),
      ),
    ).rejects.toThrow("beyond the published sequence");
  });

  test("rolls back an attachment when its initial sink throws", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    let sinkCalls = 0;

    await expect(
      Effect.runPromise(
        service.attach({
          terminalId: "terminal-1",
          attachmentId: "broken-renderer",
          lastConsumedSequence: 0,
          sink: () => {
            sinkCalls += 1;
            throw new Error("socket closed");
          },
        }),
      ),
    ).rejects.toThrow("socket closed");

    pty.emit(new Uint8Array([1]));
    expect(sinkCalls).toBe(1);
  });

  test("updates started-directory availability without replacing the terminal", async () => {
    directoryAvailable = true;
    const { service } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    directoryAvailable = false;
    const listed = await Effect.runPromise(service.list({ kind: "all" }));
    expect(listed.terminals[0]?.initialWorkingDirAvailable).toBe(false);
    directoryAvailable = true;
  });

  test("does not advance pending output until ACK and pauses at the hard bound", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "a",
        lastConsumedSequence: 0,
        sink: () => undefined,
      }),
    );
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes));
    await Bun.sleep(0);
    expect(pty.operations).toContain("pause");
    await Effect.runPromise(
      service.acknowledge("terminal-1", "a", TERMINAL_LIMITS.pendingOutputBytes),
    );
    expect(pty.operations).toContain("resume");
  });

  test("resumes output when the pressure-causing attachment detaches", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "slow-renderer",
        lastConsumedSequence: 0,
        sink: () => undefined,
      }),
    );
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes));
    await Bun.sleep(0);

    await Effect.runPromise(service.detach("terminal-1", "slow-renderer"));

    expect(pty.operations).toEqual(["pause", "resume"]);
    const replayed: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "replacement-renderer",
        lastConsumedSequence: TERMINAL_LIMITS.pendingOutputBytes,
        sink: (event) => replayed.push(event.type),
      }),
    );
    expect(replayed).toEqual(["snapshot"]);
  });

  test("terminates with overflow when output pause is unsupported", async () => {
    let id = 0;
    const { service, pty } = await makeService(makePty(false), () => `terminal-${++id}`);
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    const events: string[] = [];
    await Effect.runPromise(
      service.attach({
        terminalId: "terminal-1",
        attachmentId: "a",
        lastConsumedSequence: 0,
        sink: (event) => events.push(event.type),
      }),
    );
    pty.emit(new Uint8Array(TERMINAL_LIMITS.pendingOutputBytes + 1));
    await Bun.sleep(0);
    expect(events).toContain("output_overflow");
    expect(pty.operations).toContain("terminate");
    const listed = await Effect.runPromise(service.list({ kind: "all" }));
    expect(listed.terminals[0]?.lifecycle).toBe("exited");
    expect(listed.terminals[0]?.attentionState).toBe("overflow");
    for (let index = 0; index < TERMINAL_LIMITS.livePerHost; index += 1) {
      await Effect.runPromise(
        service.create({ workingDir: "/repo", context: { taskId: `replacement-${index}` } }),
      );
    }
  });

  test("requires confirmation and keeps close failures retryable", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: false })),
    ).rejects.toThrow();
    pty.failTerminate();
    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true })),
    ).rejects.toThrow();
    const listed = await Effect.runPromise(service.list({ kind: "all" }));
    expect(listed.terminals[0]?.lifecycle).toBe("close_failed");
  });

  test("closes an idle shell without confirmation", async () => {
    const { service, pty } = await makeService(makePty(true, false));
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));

    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: false }));

    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
    expect(pty.operations).toEqual(["inspect-children", "terminate"]);
  });

  test("removes a close-failed session after its PTY cleanup retry succeeds", async () => {
    const { service, pty } = await makeService();
    await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
    pty.failNextTerminate();

    await expect(
      Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true })),
    ).rejects.toThrow();
    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals[0]?.lifecycle).toBe(
      "close_failed",
    );

    await Effect.runPromise(service.close({ terminalId: "terminal-1", confirmTerminate: true }));

    expect((await Effect.runPromise(service.list({ kind: "all" }))).terminals).toEqual([]);
    expect(pty.operations).toContain("terminate");
  });
});
