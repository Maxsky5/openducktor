import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { formatTerminalPathInput } from "../application/terminals/terminal-path-input";
import type { TerminalNativeFixture } from "./terminal-action-native.fixture";

export async function checkRestart(fixture: TerminalNativeFixture) {
  const {
    root,
    start,
    write,
    writeRaw,
    wait,
    activities,
    outputs,
    inputs,
    engine,
    serverCommand,
    readScreen,
    captureScreen,
    exitShell,
  } = fixture;
  // The old server reads one line after SIGINT before it exits.
  const stoppingServer = await serverCommand(true);
  const actionRoot = join(root, "action's root");
  await mkdir(join(actionRoot, "target"), { recursive: true });
  const longCommand = `ODT_LONG_ACTION='${"xé🙂".repeat(200)}' ${stoppingServer}`;
  captureScreen("restart");
  await start("restart", ["cd target", "export ODT_VALUE=kept", longCommand], actionRoot);
  await wait(
    () =>
      activities.get("restart")?.restartable === true &&
      outputs.get("restart")!.includes("SERVER_READY\r\n"),
  );
  const finishStop = async (stops: number) => {
    await wait(() => outputs.get("restart")!.split("SERVER_STOPPING\r\n").length === stops + 1);
    assert.equal(inputs.get("restart")!.at(-1), "\u0003");
    await writeRaw("restart", "finish\r");
  };
  for (const starts of [2, 3]) {
    const restart = Effect.runPromise(
      Effect.result(engine.restart("restart", activities.get("restart")!.command)),
    );
    await finishStop(starts - 1);
    const restarted = await restart;
    if (restarted._tag === "Failure") throw restarted.failure;
    assert.equal(
      inputs.get("restart")!.at(-1),
      `\u001b[200~${longCommand}\u001b[201~\r`,
      "Restart must send the full direct command",
    );
    await wait(
      () =>
        activities.get("restart")?.restartable === true &&
        outputs.get("restart")!.split("SERVER_READY\r\n").length === starts + 1,
    );
  }
  const screen = await readScreen("restart");
  assert.ok(
    !screen.some((line) => line.includes("builtin eval") || line.includes("builtin cd --")),
  );
  const output = outputs.get("restart")!;
  assert.deepEqual(output.match(/SERVER_(?:READY|STOPPING|STOPPED)\r\n/gu), [
    "SERVER_READY\r\n",
    "SERVER_STOPPING\r\n",
    "SERVER_STOPPED\r\n",
    "SERVER_READY\r\n",
    "SERVER_STOPPING\r\n",
    "SERVER_STOPPED\r\n",
    "SERVER_READY\r\n",
  ]);
  const serverDirectory = await realpath(join(actionRoot, "target"));
  assert.equal(output.split(`SERVER_CWD=${serverDirectory}\r\n`).length, 4);
  await write("restart", "\u0003");
  await finishStop(3);
  await wait(() => !activities.has("restart"));
  await exitShell("restart");

  const command = await serverCommand();
  const cancelled = await start("cancel", [command, "print SHOULD_NOT_RUN"], root, "host");
  await wait(() => outputs.get("cancel")!.includes("SERVER_READY\r\n"));
  await write("cancel", "\u0003");
  const cancelledResult = await Effect.runPromise(
    cancelled.result.pipe(Effect.timeout("2 seconds")),
  );
  assert.equal(cancelledResult.type, "failed");
  assert.ok(cancelledResult.type === "failed" && cancelledResult.message.includes("stopped"));
  assert.equal(
    inputs.get("cancel")!.some((input) => input.includes("SHOULD_NOT_RUN")),
    false,
  );
  await write("cancel", "\u001b[A\r");
  await wait(() => outputs.get("cancel")!.split("SERVER_READY\r\n").length === 3);
  await write("cancel", "\u0003");
  await wait(() => !activities.has("cancel"));
  await exitShell("cancel");

  const replaced = await start("exec", [`exec ${command}`]);
  await wait(() => activities.has("exec") && outputs.get("exec")!.includes("SERVER_READY\r\n"));
  assert.equal(activities.get("exec")?.restartable, false);
  await write("exec", "\u0003");
  const replacedResult = await Effect.runPromise(replaced.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(replacedResult.type, "failed");
  assert.equal(
    engine.list({ kind: "all" }).find((item) => item.terminalId === "exec")?.lifecycle,
    "exited",
  );

  // Close stops the running Action through SIGTERM.
  const closing = await start("close", ["trap 'exit 0' TERM", command]);
  await wait(() => outputs.get("close")!.includes("SERVER_READY\r\n"));
  await Effect.runPromise(engine.close("close", true));
  assert.equal((await Effect.runPromise(closing.result)).type, "closed");
}

export async function checkSetupRestart(fixture: TerminalNativeFixture) {
  const { root, start, write, wait, activities, outputs, engine, serverCommand, exitShell } =
    fixture;
  const command = await serverCommand();
  const setupCommand = await inputCommand(fixture);
  const setup = await start("setup", [setupCommand], root, "host");
  await wait(() => activities.has("setup") && outputs.get("setup")!.includes("SETUP_READY\r\n"));
  assert.equal(activities.get("setup")?.restartable, false);
  const refused = await Effect.runPromise(
    Effect.result(engine.restart("setup", activities.get("setup")!.command)),
  );
  assert.equal(refused._tag, "Failure");
  assert.ok(refused._tag === "Failure" && refused.failure.message.includes("setup"));
  await write("setup", "done\r");
  const setupResult = await Effect.runPromise(setup.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(setupResult.type === "exited" && setupResult.exitCode, 0);
  assert.ok(!outputs.get("setup")!.includes("SETUP_INTERRUPTED\r\n"));
  await write("setup", `cd . && ${command}\r`);
  await wait(
    () =>
      activities.get("setup")?.restartable === true &&
      outputs.get("setup")!.includes("SERVER_READY\r\n"),
  );
  await Effect.runPromise(engine.restart("setup", activities.get("setup")!.command));
  await wait(() => outputs.get("setup")!.split("SERVER_READY\r\n").length === 3);
  await write("setup", "\u0003");
  await wait(() => !activities.has("setup"));
  await exitShell("setup");
}

export async function checkErrExitRestart(fixture: TerminalNativeFixture) {
  const { start, write, wait, activities, outputs, inputs, engine, exitShell } = fixture;
  const setupCommand = await inputCommand(fixture);
  const cases = {
    "err-exit-action": ["set -e", setupCommand],
    "err-exit-manual": ["true"],
    "set-e-line": ["true", `set -e; ${setupCommand}`],
    "setopt-line": ["true", `setopt ERR_EXIT; ${setupCommand}`],
  } as const;
  for (const [id, commandLines] of Object.entries(cases)) {
    const manual = id === "err-exit-manual";
    const action = await start(id, [...commandLines]);
    if (manual) {
      await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
      await write(id, "set -e\r");
      await wait(() => outputs.get(id)!.split("\u001b]633;R;").length >= 4);
      await write(id, `${setupCommand}\r`);
    }
    await wait(
      () =>
        outputs.get(id)!.includes("SETUP_READY\r\n") &&
        activities.get(id)?.command === (manual ? setupCommand : commandLines.at(-1)),
    );
    assert.equal(activities.get(id)?.restartable, false);
    const count = inputs.get(id)!.length;
    const refused = await Effect.runPromise(
      Effect.result(engine.restart(id, activities.get(id)!.command)),
    );
    assert.ok(refused._tag === "Failure");
    assert.ok(refused.failure.message.includes("no command that can restart"));
    assert.equal(inputs.get(id)!.length, count);
    assert.equal(
      engine.list({ kind: "all" }).find((item) => item.terminalId === id)?.lifecycle,
      "running",
    );
    assert.ok(!outputs.get(id)!.includes("SETUP_INTERRUPTED\r\n"));
    const prompts = outputs.get(id)!.split("\u001b]633;R;").length;
    await write(id, "done\r");
    await wait(() => outputs.get(id)!.split("\u001b]633;R;").length > prompts);
    const result = await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
    assert.equal(result.type === "exited" && result.exitCode, 0);
    if (id === "err-exit-action") {
      await write(id, "unsetopt ERR_EXIT\r");
      await wait(() => outputs.get(id)!.split("\u001b]633;R;").length > prompts + 1);
      await write(id, `${setupCommand}\r`);
      await wait(
        () =>
          activities.get(id)?.restartable === true &&
          outputs.get(id)!.split("SETUP_READY\r\n").length === 3,
      );
      await Effect.runPromise(engine.restart(id, activities.get(id)!.command));
      await wait(() => outputs.get(id)!.split("SETUP_READY\r\n").length === 4);
      await write(id, "done\r");
      await wait(() => !activities.has(id));
    }
    await exitShell(id);
  }
}

export async function checkFinishedInput(
  fixture: TerminalNativeFixture,
  input: "restart" | "interrupt",
) {
  const {
    root,
    start,
    write,
    wait,
    activities,
    outputs,
    inputs,
    engine,
    exitShell,
    notifyTerminalChange,
  } = fixture;
  const setupCommand = await inputCommand(fixture);
  const finished = await start(
    "finished",
    [setupCommand],
    root,
    input === "interrupt" ? "host" : "user",
  );
  await wait(
    () =>
      activities.get("finished")?.restartable === (input === "restart") &&
      outputs.get("finished")!.includes("SETUP_READY\r\n"),
  );
  let request: Promise<string | null> | null = null;
  let stale = false;
  let completion = "";
  await Effect.runPromise(
    engine.attach({
      terminalId: "finished",
      attachmentId: "finished-restart",
      lastConsumedSequence: 0,
      sink: (event, data) => {
        if (event.type !== "output" || event.replay || request !== null) return;
        completion += new TextDecoder().decode(data);
        if (!completion.split("\u001b]633;D;")[1]?.includes("\u0007")) return;
        stale = activities.has("finished");
        const operation =
          input === "restart"
            ? engine.restart("finished", setupCommand)
            : engine.write("finished", new Uint8Array([3]));
        request = Effect.runPromise(Effect.result(operation)).then((result) =>
          result._tag === "Failure" ? result.failure.message : null,
        );
        notifyTerminalChange();
      },
    }),
  );
  const count = inputs.get("finished")!.length;
  await write("finished", "done\r");
  await wait(() => request !== null);
  assert.equal(stale, true);
  if (input === "restart") assert.match((await request!) ?? "", /no command that can restart/u);
  else assert.equal(await request!, null);
  assert.deepEqual(
    inputs.get("finished")!.slice(count),
    input === "restart" ? ["done\r"] : ["done\r", "\u0003"],
  );
  const result = await Effect.runPromise(finished.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(result.type === "exited" && result.exitCode, 0);
  await exitShell("finished");
}

async function inputCommand({ root, shell }: TerminalNativeFixture) {
  const script = join(root, "setup.sh");
  await writeFile(
    script,
    `trap 'printf "SETUP_INTERRUPTED\\n"; exit 130' INT
printf 'SETUP_READY\\n'
IFS= read -r line
`,
  );
  return formatTerminalPathInput(shell, ["/bin/sh", script]);
}
