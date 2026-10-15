import assert from "node:assert/strict";
import { Effect } from "effect";
import { createNodePtyPort } from "../adapters/node/pty-process-adapter";
import { createTerminalSessionEngine } from "../application/terminals/terminal-session-engine";
import { createTerminalLaunchEnvironment } from "../infrastructure/terminals/terminal-launch-environment";
import type { TerminalNativeFixture } from "./terminal-action-native.fixture";

export async function checkSubmit({ root, shell, wait }: TerminalNativeFixture) {
  const native = createNodePtyPort();
  let output = "";
  let input: "accepted" | "rejected" | null = null;
  let message = "";
  let typed = false;
  let engine: ReturnType<typeof createTerminalSessionEngine>;
  engine = createTerminalSessionEngine({
    now: () => new Date(),
    ptyPort: {
      start: (plan, handlers) =>
        native.start(plan, {
          ...handlers,
          onOutput: (data) => {
            output += new TextDecoder().decode(data);
            if (!typed && output.includes(`\u001b]633;R;${plan.commandNonce};1\u0007`)) {
              typed = true;
              void Effect.runPromise(
                Effect.result(
                  engine.write("submit", new TextEncoder().encode("print INPUT_RACED; ")),
                ),
              ).then((result) => {
                input = result._tag === "Failure" ? "rejected" : "accepted";
                if (result._tag === "Failure") message = result.failure.message;
              });
            }
            handlers.onOutput(data);
          },
        }),
    },
  });
  try {
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
    const lines = ["print ACTION_SUBMITTED"] as const;
    const plans = await Effect.runPromise(environment.command(lines));
    const grid = { columns: 120, rows: 24 };
    const action = await Effect.runPromise(
      engine.startCommand(
        {
          terminalId: "submit",
          label: "submit",
          context: {},
          initialWorkingDir: root,
          createdAt: new Date().toISOString(),
          lifecycle: "starting",
          exit: null,
          startedBy: "user",
        },
        { commandLines: lines },
        {
          command: { ...plans.command, cwd: root, grid },
          shell: { ...plans.shell, cwd: root, grid },
        },
      ),
    );
    const result = await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
    await wait(() => input !== null);
    assert.equal(input, "rejected", output);
    assert.ok(message.includes("Action"), message);
    assert.equal(result.type === "exited" && result.exitCode, 0);
    assert.ok(!output.includes("\r\nINPUT_RACED\r\n"), output);
    await Effect.runPromise(
      engine.write("submit", new TextEncoder().encode("print AFTER_SUBMIT\r")),
    );
    await wait(() => output.includes("AFTER_SUBMIT\r\n"));
  } finally {
    await Effect.runPromise(engine.dispose());
  }
}
