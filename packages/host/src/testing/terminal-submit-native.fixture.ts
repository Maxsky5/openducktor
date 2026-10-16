import assert from "node:assert/strict";
import { Effect } from "effect";
import { createNodePtyPort } from "../adapters/node/pty-process-adapter";
import { createTerminalSessionEngine } from "../application/terminals/terminal-session-engine";
import { createTerminalLaunchEnvironment } from "../infrastructure/terminals/terminal-launch-environment";
import type { TerminalNativeFixture } from "./terminal-action-native.fixture";

export async function checkSubmit({ root, shell, wait }: TerminalNativeFixture) {
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
  for (const [id, lines, prompt, rejected] of [
    ["initial", ["print ACTION_SUBMITTED"], 1, true],
    ["next", ["print FIRST_LINE", "print ACTION_SUBMITTED"], 2, true],
    ["last", ["print FIRST_LINE", "print ACTION_SUBMITTED"], 3, false],
    [
      "stdin",
      ["print INPUT_READY; read answer; print REPLY=$answer", "print ACTION_SUBMITTED"],
      null,
      false,
    ],
  ] as const) {
    const engine = createTerminalSessionEngine({
      now: () => new Date(),
      ptyPort: createNodePtyPort(),
    });
    let output = "";
    let input: "accepted" | "rejected" | null = null;
    let message = "";
    let typed = false;
    try {
      const plans = await Effect.runPromise(environment.command(lines));
      const grid = { columns: 120, rows: 24 };
      const action = await Effect.runPromise(
        engine.startCommand(
          {
            terminalId: id,
            label: id,
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
      await Effect.runPromise(
        engine.attach({
          terminalId: id,
          attachmentId: id,
          lastConsumedSequence: 0,
          sink: (event, data) => {
            if (event.type !== "output") return;
            output += new TextDecoder().decode(data);
            const ready =
              prompt === null
                ? output.includes("INPUT_READY\r\n")
                : output.split("\u001b]633;R;").length > prompt;
            if (!typed && ready) {
              typed = true;
              void Effect.runPromise(
                Effect.result(
                  engine.write(
                    id,
                    new TextEncoder().encode(prompt === null ? "answer\r" : "print INPUT_RACED; "),
                  ),
                ),
              ).then((result) => {
                input = result._tag === "Failure" ? "rejected" : "accepted";
                if (result._tag === "Failure") message = result.failure.message;
              });
            }
          },
        }),
      );
      const result = await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
      await wait(() => input !== null);
      assert.equal(input, rejected ? "rejected" : "accepted", `${id}: ${output}`);
      if (rejected) assert.ok(message.includes("Action"), message);
      assert.equal(result.type === "exited" && result.exitCode, 0);
      assert.ok(!output.includes("INPUT_RACED\r\n"), output);
      await Effect.runPromise(engine.write(id, new TextEncoder().encode("print AFTER_SUBMIT\r")));
      await wait(() => output.includes("AFTER_SUBMIT\r\n"));
      assert.equal(output.includes("INPUT_RACED\r\n"), !rejected && prompt !== null, output);
      if (prompt === null) assert.ok(output.includes("REPLY=answer\r\n"), output);
    } finally {
      await Effect.runPromise(engine.dispose());
    }
  }
}
