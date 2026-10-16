import { checkHooks } from "./terminal-hooks-native.fixture";
import { checkSubmit } from "./terminal-submit-native.fixture";
import { checkClose } from "./terminal-close-native.fixture";
import { checkDirect } from "./terminal-direct-native.fixture";
import { checkBuffer, checkReady } from "./terminal-ready-native.fixture";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalActivity, TerminalStartedBy } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  StartedCommandTerminal,
  TerminalCommandLines,
} from "../application/terminals/terminal-command";
import { formatTerminalPathInput } from "../application/terminals/terminal-path-input";
import { createTerminalSessionEngine } from "../application/terminals/terminal-session-engine";
import { createTerminalLaunchEnvironment } from "../infrastructure/terminals/terminal-launch-environment";
import { TerminalScreenState } from "../application/terminals/terminal-screen-state";
import type { TerminalPtyHandle } from "../ports/terminal-pty-port";
import { createNodePtyPort } from "../adapters/node/pty-process-adapter";

const root = await mkdtemp(join(tmpdir(), "odt-action-native-"));
const shell = process.env.ODT_TEST_ZSH!;
const launchEnvironment = createTerminalLaunchEnvironment({
  readEnv: () => ({
    HOME: root,
    ZDOTDIR: root,
    PATH: process.env.PATH!,
    SHELL: shell,
    TERM: "xterm-256color",
    LC_ALL: "C.UTF-8",
  }),
  readUserShell: () => shell,
});
const nativePty = createNodePtyPort();
const handles: TerminalPtyHandle[] = [];
const terminals = new Map<string, TerminalPtyHandle>();
const screens = new Map<string, TerminalScreenState>();
const inputs = new Map<string, string[]>();
const writes: string[][] = [];
const engine = createTerminalSessionEngine({
  now: () => new Date(),
  ptyPort: {
    start: (plan, handlers) =>
      nativePty.start(plan, handlers).pipe(
        Effect.map((handle) => {
          const input: string[] = [];
          writes.push(input);
          return {
            ...handle,
            write: (data: Uint8Array) => {
              input.push(new TextDecoder().decode(data));
              return handle.write(data);
            },
          };
        }),
        Effect.tap((handle) =>
          Effect.sync(() => {
            handles.push(handle);
          }),
        ),
      ),
  },
});
const activities = new Map<string, TerminalActivity>();
const outputs = new Map<string, string>();
const failures = new Map<string, string>();
const stop = engine.observeActivity((message) => {
  if (message.type === "activity_updated")
    activities.set(message.activity.summary.terminalId, message.activity);
  else if (message.type === "activity_removed") activities.delete(message.terminalId);
});
const fixture = {
  root,
  shell,
  engine,
  activities,
  outputs,
  failures,
  inputs,
  screens,
  start,
  write,
  writeRaw,
  readScreen,
  wait,
  serverCommand,
};
export type TerminalNativeFixture = typeof fixture;
const cases = new Map([
  ["submit", () => checkSubmit(fixture)],
  ["close", () => checkClose(fixture)],
  ["direct", () => checkDirect(fixture)],
  ["history", checkHistory],
  ["state", checkState],
  ["restart", checkRestart],
  ["hooks", () => checkHooks(fixture)],
  ["manual", checkManual],
  ["ready", () => checkReady(fixture)],
  ["buffer", () => checkBuffer(fixture)],
]);
try {
  await writeFile(
    join(root, ".zshrc"),
    'PROMPT="fixture> "\nHISTFILE="$HOME/history"\nHISTSIZE=1000\nSAVEHIST=1000\nuser_precmd() { true; }\nprecmd_functions=(user_precmd)\n',
  );
  const name = process.argv[2] ?? "";
  const check = cases.get(name);
  assert.ok(check, `Unknown terminal case: ${name}`);
  await check();
  console.log(`PASS ${name}`);
} catch (cause) {
  throw new Error(JSON.stringify([...outputs].map(([id, output]) => [id, output.slice(-1200)])), {
    cause,
  });
} finally {
  stop();
  await Effect.runPromise(engine.dispose());
  await Promise.all([...screens.values()].map((screen) => screen.drained()));
  for (const screen of screens.values()) screen.dispose();
  await rm(root, { recursive: true, force: true });
}

async function wait(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate(), JSON.stringify([...outputs]));
}
function write(id: string, text: string): Promise<void> {
  return Effect.runPromise(engine.write(id, new TextEncoder().encode(text)));
}
function writeRaw(id: string, text: string): Promise<void> {
  return Effect.runPromise(terminals.get(id)!.write(new TextEncoder().encode(text)));
}
async function readScreen(id: string): Promise<readonly string[]> {
  const screen = screens.get(id)!;
  await screen.drained();
  return screen.outputTail(100);
}
async function start(
  id: string,
  commandLines: TerminalCommandLines,
  workingDir = root,
  startedBy: TerminalStartedBy = "user",
): Promise<StartedCommandTerminal> {
  const plans = await Effect.runPromise(launchEnvironment.command(commandLines));
  const grid = { columns: 120, rows: 24 };
  const handleIndex = handles.length;
  screens.set(id, new TerminalScreenState(grid));
  const started = await Effect.runPromise(
    engine.startCommand(
      {
        terminalId: id,
        label: id,
        context: { repoPath: root, taskId: "fixture" },
        initialWorkingDir: workingDir,
        createdAt: new Date().toISOString(),
        lifecycle: "starting",
        exit: null,
        startedBy,
      },
      { commandLines },
      {
        command: { ...plans.command, cwd: workingDir, grid },
        shell: { ...plans.shell, cwd: workingDir, grid },
      },
    ),
  );
  terminals.set(id, handles[handleIndex]!);
  inputs.set(id, writes[handleIndex]!);
  outputs.set(id, "");
  await Effect.runPromise(
    engine.attach({
      terminalId: id,
      attachmentId: id,
      lastConsumedSequence: 0,
      sink: (event, data) => {
        if (event.type === "protocol_error") failures.set(id, event.failure.message);
        if (event.type === "output") {
          screens.get(id)!.write(data, () => {});
          outputs.set(id, outputs.get(id)! + new TextDecoder().decode(data));
        }
      },
    }),
  );
  return started;
}

async function checkHistory() {
  await writeFile(join(root, "history"), "echo another-shell\n");
  const historyCommand = "node history.cjs";
  await writeFile(
    join(root, "history.cjs"),
    'process.on("SIGINT", () => process.exit(0)); console.log("HISTORY_READY"); setInterval(() => {}, 1000);',
  );
  const history = await start("history", [historyCommand]);
  await wait(
    () =>
      activities.get("history")?.restartable === true &&
      outputs.get("history")!.includes("HISTORY_READY\r\n"),
  );
  assert.ok((await readScreen("history")).includes(`fixture> ${historyCommand}`));
  await write("history", "\u0003");
  assert.equal(
    (await Effect.runPromise(history.result.pipe(Effect.timeout("2 seconds")))).type,
    "exited",
  );
  await wait(() => outputs.get("history")!.includes("fixture> "));
  outputs.set("history", "");
  await write("history", "\u001b[A");
  await wait(
    () =>
      outputs.get("history")!.includes(historyCommand) ||
      outputs.get("history")!.includes("another-shell"),
  );
  assert.ok(outputs.get("history")!.includes(historyCommand), "Up Arrow must recall the Action");
  const recalled = await readScreen("history");
  assert.equal(recalled.at(-1), `fixture> ${historyCommand}`);
  await write("history", "\r");
  await wait(() => outputs.get("history")!.includes("HISTORY_READY\r\n"));
  await write("history", "\u0003");
  await wait(() => !activities.has("history"));
  await write("history", "\u001b[A");
  await wait(() => outputs.get("history")!.split(historyCommand).length >= 3);
  await write("history", "\u0001\u000bprint EDITED\r");
  await wait(() => outputs.get("history")!.includes("EDITED\r\n"));
  await write("history", "exit\r");
  await wait(
    () =>
      engine.list({ kind: "all" }).find((item) => item.terminalId === "history")?.lifecycle ===
      "exited",
  );
  assert.ok((await readFile(join(root, "history"), "utf8")).includes(historyCommand));

  for (const [id, commandLine, exitCode] of [
    ["exit", "exit 7", 7],
    ["logout", "logout 9", 9],
  ] as const) {
    const action = await start(id, [commandLine, "echo NEVER"]);
    const result = await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
    assert.equal(result.type === "exited" && result.exitCode, exitCode);
    assert.equal(
      engine.list({ kind: "all" }).find((item) => item.terminalId === id)?.lifecycle,
      "exited",
    );
    assert.ok(!outputs.get(id)!.includes("\r\nNEVER\r\n"));
  }
}

async function checkState() {
  const target = join(root, "target");
  await mkdir(target);
  const state = await start("state", [
    `cd '${target}'`,
    "export ODT_VALUE=kept",
    'printf "VALUE=%s\\n" "$ODT_VALUE"',
    'printf "SEMI\\n";',
    "false && true",
    "echo NEVER",
  ]);
  const result = await Effect.runPromise(state.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(result.type === "exited" && result.exitCode, 1);
  assert.ok(outputs.get("state")!.includes("VALUE=kept\r\n"));
  assert.ok(!outputs.get("state")!.includes("VALUE=#"));
  assert.ok(!outputs.get("state")!.includes("\r\nNEVER\r\n"));
  await write("state", 'printf "AFTER=%s:%s\\n" "$PWD" "$ODT_VALUE"\r');
  const directory = target;
  await wait(() => outputs.get("state")!.includes(`AFTER=${directory}:kept\r\n`));
  await write("state", 'printf "COMMENTS=%s\\n" "$options[interactivecomments]"\r');
  await wait(() => outputs.get("state")!.includes("COMMENTS=off\r\n"));
  const syntax = await start("syntax", ["echo )"]);
  const syntaxResult = await Effect.runPromise(syntax.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(syntaxResult.type === "exited" && syntaxResult.exitCode, 1);
  await writeFile(join(root, ".zshrc"), 'PROMPT="fixture> "\nHISTSIZE=0\nSAVEHIST=0\n');
  const noHistory = await start("no-history", ["true"]);
  const noHistoryResult = await Effect.runPromise(
    noHistory.result.pipe(Effect.timeout("2 seconds")),
  );
  assert.equal(noHistoryResult.type === "exited" && noHistoryResult.exitCode, 0);

  for (const [id, lines, exitCode, expected] of [
    ["err-exit", ["set -e", "false; echo CONTINUED", "echo LATER"], 1, []],
    ["command-list", ["false; echo CONTINUED", "echo LATER"], 0, ["CONTINUED", "LATER"]],
  ] as const) {
    const action = await start(id, [...lines]);
    const result = await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
    assert.ok(result.type === "exited");
    assert.equal(result.exitCode, exitCode);
    assert.deepEqual(
      result.outputTail.filter((line) => line === "CONTINUED" || line === "LATER"),
      expected,
    );
    assert.equal(
      engine.list({ kind: "all" }).find((item) => item.terminalId === id)?.lifecycle,
      id === "err-exit" ? "exited" : "running",
    );
  }
}

async function checkRestart() {
  const command = await serverCommand();
  const setupScript = join(root, "setup.cjs");
  await writeFile(
    setupScript,
    'process.on("SIGINT", () => { console.log("SETUP_INTERRUPTED"); process.exit(130); }); process.stdin.once("data", () => process.exit(0)); console.log("SETUP_READY"); process.stdin.resume();',
  );
  const setup = await start(
    "setup",
    [formatTerminalPathInput(shell, [process.execPath, setupScript])],
    root,
    "host",
  );
  await wait(() => outputs.get("setup")!.includes("SETUP_READY\r\n"));
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
  await write("setup", `${command}\r`);
  await wait(
    () =>
      activities.get("setup")?.restartable === true &&
      outputs.get("setup")!.includes("SERVER_READY\r\n"),
  );
  await Effect.runPromise(engine.restart("setup", activities.get("setup")!.command));
  await wait(() => outputs.get("setup")!.split("SERVER_READY\r\n").length === 3);

  const setupCommand = formatTerminalPathInput(shell, [process.execPath, setupScript]);
  for (const manual of [false, true]) {
    const id = manual ? "err-exit-manual" : "err-exit-action";
    const action = await start(id, manual ? ["true"] : ["set -e", setupCommand]);
    if (manual) {
      await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
      await write(id, "set -e\r");
      await wait(() => outputs.get(id)!.split("\u001b]633;R;").length >= 4);
      await write(id, `${setupCommand}\r`);
    }
    await wait(() => outputs.get(id)!.includes("SETUP_READY\r\n"));
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
  }

  const actionRoot = join(root, "action's root");
  await mkdir(join(actionRoot, "target"), { recursive: true });
  const longCommand = `ODT_LONG_ACTION='${"xé🙂".repeat(200)}' ${command}`;
  await start("restart", ["cd target", "export ODT_VALUE=kept", longCommand], actionRoot);
  await wait(
    () =>
      activities.get("restart")?.restartable === true &&
      outputs.get("restart")!.includes("SERVER_READY\r\n"),
  );
  for (const starts of [2, 3]) {
    await Effect.runPromise(engine.restart("restart", activities.get("restart")!.command));
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

  const cancelled = await start("cancel", [command, "print SHOULD_NOT_RUN"]);
  await wait(() => outputs.get("cancel")!.includes("SERVER_READY\r\n"));
  await write("cancel", "\u0003");
  const cancelledResult = await Effect.runPromise(
    cancelled.result.pipe(Effect.timeout("2 seconds")),
  );
  assert.ok(cancelledResult.type === "exited");
  assert.ok(cancelledResult.exitCode === 0 || cancelledResult.exitCode === 130);
  assert.equal(
    inputs.get("cancel")!.some((input) => input.includes("SHOULD_NOT_RUN")),
    false,
  );
  await write("cancel", "\u001b[A\r");
  await wait(() => outputs.get("cancel")!.split("SERVER_READY\r\n").length === 3);

  const replaced = await start("exec", [`exec ${command}`]);
  await wait(() => outputs.get("exec")!.includes("SERVER_READY\r\n"));
  assert.equal(activities.get("exec")?.restartable, false);
  await write("exec", "\u0003");
  const replacedResult = await Effect.runPromise(replaced.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(replacedResult.type === "exited" && replacedResult.exitCode, 0);
  assert.equal(
    engine.list({ kind: "all" }).find((item) => item.terminalId === "exec")?.lifecycle,
    "exited",
  );

  const closing = await start("close", [command]);
  await wait(() => outputs.get("close")!.includes("SERVER_READY\r\n"));
  await Effect.runPromise(engine.close("close", true));
  assert.equal((await Effect.runPromise(closing.result)).type, "closed");
}

async function checkManual() {
  const command = await serverCommand();
  await writeFile(
    join(root, ".zshrc"),
    `PROMPT="fixture> "\nHISTSIZE=1000\nsetopt SH_WORD_SPLIT\nalias run_server=${formatTerminalPathInput(shell, [`exec ${command}`])}\n`,
  );
  for (const [name, input, restartable] of [
    ["plain", `exec ${command}`, false],
    ["and", `cd '${root}' && exec ${command}`, false],
    ["or", `false || exec ${command}`, false],
    ["list", `true; exec ${command}`, false],
    ["builtin", `ODT_VALUE=1 builtin exec ${command}`, false],
    ["assignment", `ODT_VALUE='two words' builtin exec ${command}`, false],
    ["quoted", `'exec' ${command}`, false],
    ["alias", "run_server", false],
    ["argument", `${command} exec`, false],
    ["ordinary", command, true],
    ["long", `ODT_VALUE='${"x".repeat(1200)}' ${command}`, true],
  ] as const) {
    const id = `manual-${name}`;
    const action = await start(id, ["true"]);
    await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
    await write(id, `${input}\r`);
    await wait(() => outputs.get(id)!.includes("SERVER_READY\r\n"));
    assert.equal(activities.get(id)?.restartable, restartable);
    const result = await Effect.runPromise(
      Effect.result(engine.restart(id, activities.get(id)!.command)),
    );
    if (restartable) {
      assert.equal(result._tag, "Success");
      await wait(() => outputs.get(id)!.split("SERVER_READY\r\n").length === 3);
    } else {
      assert.ok(result._tag === "Failure");
      assert.equal(result.failure.code, "invalid_input");
      assert.ok(result.failure.message.includes("no command that can restart"));
      assert.ok(!outputs.get(id)!.includes("SERVER_STOPPING\r\n"));
      assert.equal(
        engine.list({ kind: "all" }).find((item) => item.terminalId === id)?.lifecycle,
        "running",
      );
    }
  }
}

async function serverCommand() {
  const server = join(root, "server.cjs");
  await writeFile(
    server,
    'process.on("SIGINT", () => { console.log("SERVER_STOPPING"); setTimeout(() => { console.log("SERVER_STOPPED"); process.exit(0); }, 40); }); console.log("SERVER_CWD=" + process.cwd()); console.log("SERVER_READY"); setInterval(() => {}, 1000);',
  );
  return formatTerminalPathInput(shell, [process.execPath, server]);
}
