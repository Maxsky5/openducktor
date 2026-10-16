import assert from "node:assert/strict";
import { Effect } from "effect";
import { createNodePtyPort } from "../adapters/node/pty-process-adapter";
import { createTerminalSessionEngine } from "../application/terminals/terminal-session-engine";
import { HostOperationError } from "../effect/host-errors";
import { terminateProcessTree } from "../infrastructure/process/process-tree";
import { createTerminalLaunchEnvironment } from "../infrastructure/terminals/terminal-launch-environment";
import type { TerminalNativeFixture } from "./terminal-action-native.fixture";

export async function checkClose({ root, shell, wait }: TerminalNativeFixture) {
  let rejectClose = true;
  const engine = createTerminalSessionEngine({
    now: () => new Date(),
    ptyPort: createNodePtyPort({
      processTreeTerminator: (input) =>
        Effect.suspend(() => {
          if (!rejectClose) return terminateProcessTree(input);
          rejectClose = false;
          return Effect.fail(
            new HostOperationError({
              operation: "process-tree.stop",
              message: "Injected process-stop failure",
            }),
          );
        }),
    }),
  });
  const environment = createTerminalLaunchEnvironment({
    readEnv: () => ({
      HOME: root,
      ZDOTDIR: root,
      PATH: process.env.PATH!,
      SHELL: shell,
      TERM: "xterm-256color",
    }),
    readUserShell: () => shell,
  });
  const lines = [
    "print COMMAND_READY; read answer; print COMMAND_DONE",
    "print LATER_LINE",
  ] as const;
  let output = "";
  let command: string | null = null;
  const stop = engine.observeActivity((message) => {
    if (message.type === "activity_updated") command = message.activity.command;
    else if (message.type === "activity_removed") command = null;
  });
  try {
    const plans = await Effect.runPromise(environment.command(lines));
    const grid = { columns: 120, rows: 24 };
    const action = await Effect.runPromise(
      engine.startCommand(
        {
          terminalId: "close",
          label: "close",
          context: { repoPath: root, taskId: "close" },
          initialWorkingDir: root,
          createdAt: new Date().toISOString(),
          lifecycle: "starting",
          exit: null,
          startedBy: "host",
        },
        { commandLines: lines },
        {
          command: { ...plans.command, cwd: root, grid },
          shell: { ...plans.shell, cwd: root, grid },
        },
      ),
    );
    await Effect.runPromise(
      engine.attach({
        terminalId: "close",
        attachmentId: "close",
        lastConsumedSequence: 0,
        sink: (event, data) => {
          if (event.type === "output") output += new TextDecoder().decode(data);
        },
      }),
    );
    await wait(() => output.includes("COMMAND_READY\r\n"));
    await assert.rejects(Effect.runPromise(engine.close("close", true)), /Failed to terminate/);
    const result = await Effect.runPromise(action.result.pipe(Effect.timeout("1 second")));
    assert.equal(result.type, "failed");
    assert.ok(result.type === "failed" && result.message.includes("Retry Close"));
    assert.ok(result.outputTail.some((line) => line.includes("COMMAND_READY")));
    assert.ok(!output.includes("COMMAND_DONE\r\n"));
    assert.equal(engine.list({ kind: "all" })[0]?.lifecycle, "close_failed");
    assert.equal(command, null);
    await Effect.runPromise(engine.write("close", new TextEncoder().encode("answer\r")));
    await wait(() => output.includes("COMMAND_DONE\r\n") && output.includes("\u001b]633;D;0;"));
    assert.deepEqual(
      (await Effect.runPromise(engine.inspectWorkspaceActivity(root))).activeTerminalIds,
      [],
    );
    await Effect.runPromise(
      engine.write("close", new TextEncoder().encode("print AFTER_CLOSE; read answer\r")),
    );
    await wait(() => output.includes("AFTER_CLOSE\r\n") && command !== null);
    await Effect.runPromise(engine.write("close", new TextEncoder().encode("answer\r")));
    await wait(() => command === null);
    assert.ok(!output.includes("LATER_LINE"));
    assert.deepEqual(await Effect.runPromise(action.result), result);
    await Effect.runPromise(engine.close("close", true));
    assert.equal(engine.list({ kind: "all" }).length, 0);
  } finally {
    stop();
    await Effect.runPromise(engine.dispose());
  }
}
