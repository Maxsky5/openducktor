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
const engine = createTerminalSessionEngine({ now: () => new Date(), ptyPort: createNodePtyPort() });
const activities = new Map<string, TerminalActivity>();
const outputs = new Map<string, string>();
const stop = engine.observeActivity((message) => {
  if (message.type === "activity_updated")
    activities.set(message.activity.summary.terminalId, message.activity);
  else if (message.type === "activity_removed") activities.delete(message.terminalId);
});
const fixture = { root, shell, engine, activities, outputs, start, write, wait };
const cases = new Map([
  ["history", checkHistory],
  ["state", checkState],
  ["restart", checkRestart],
  ["hooks", checkHooks],
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
async function start(
  id: string,
  commandLines: TerminalCommandLines,
  workingDir = root,
  startedBy: TerminalStartedBy = "user",
): Promise<StartedCommandTerminal> {
  const plans = await Effect.runPromise(launchEnvironment.command(commandLines));
  const grid = { columns: 120, rows: 24 };
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
  outputs.set(id, "");
  await Effect.runPromise(
    engine.attach({
      terminalId: id,
      attachmentId: id,
      lastConsumedSequence: 0,
      sink: (event, data) => {
        if (event.type === "output")
          outputs.set(id, outputs.get(id)! + new TextDecoder().decode(data));
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
  await write("history", "\u0003exit\r");
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
      "running",
    );
    assert.ok(!outputs.get(id)!.includes("\r\nNEVER\r\n"));
    await write(id, 'printf "PROMPT_ALIVE\\n"\r');
    await wait(() => outputs.get(id)!.includes("PROMPT_ALIVE\r\n"));
  }
}

async function checkState() {
  const target = join(root, "target");
  await mkdir(target);
  const state = await start("state", [
    `cd '${target}'`,
    "export ODT_VALUE=kept",
    'printf "VALUE=%s\\n" "$ODT_VALUE" # inline comment',
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
  await wait(() => outputs.get("state")!.includes(`AFTER=${root}:\r\n`));
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
      "running",
    );
    await write(id, 'printf "AFTER_ERR_EXIT=%s\\n" "$options[errexit]"\r');
    await wait(() => outputs.get(id)!.includes("AFTER_ERR_EXIT=off\r\n"));
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

  const actionRoot = join(root, "action's root");
  await mkdir(join(actionRoot, "target"), { recursive: true });
  const unpadded = await Effect.runPromise(
    launchEnvironment.command(["cd target", "export ODT_LONG_ACTION=", `exec ${command}`]),
  );
  const gap = 1000 - new TextEncoder().encode(unpadded.command.interactiveCommand!).byteLength;
  const padding = "xé🙂".repeat(Math.floor(gap / 7)) + "x".repeat(gap % 7);
  await start(
    "restart",
    ["cd target", `export ODT_LONG_ACTION=${padding}`, `exec ${command}`],
    actionRoot,
  );
  await wait(
    () =>
      activities.get("restart")?.restartable === true &&
      outputs.get("restart")!.includes("SERVER_READY\r\n"),
  );
  for (const starts of [2, 3]) {
    await Effect.runPromise(engine.restart("restart", activities.get("restart")!.command));
    await wait(
      () =>
        activities.get("restart")?.restartable === true &&
        outputs.get("restart")!.split("SERVER_READY\r\n").length === starts + 1,
    );
  }
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

  const closing = await start("close", [command]);
  await wait(() => outputs.get("close")!.includes("SERVER_READY\r\n"));
  await Effect.runPromise(engine.close("close", true));
  assert.equal((await Effect.runPromise(closing.result)).type, "closed");
}

async function checkHooks() {
  const command = await serverCommand();
  for (const [hook, commandLine, exitCode] of [
    ["named", "true", 0],
    ["array", "false", 1],
  ] as const) {
    await rm(join(root, "fail-hook"), { force: true });
    const fail =
      'if [[ -f "$HOME/fail-hook" ]]; then setopt localoptions nounset; print "$ODT_MISSING_HOOK_VALUE"; fi';
    await writeFile(
      join(root, ".zshrc"),
      [
        'PROMPT="fixture> "',
        `precmd() { local code=$?; print -r -- "NAMED_STATUS=$code"; ${hook === "named" ? fail : "true"}; }`,
        `user_precmd() { local code=$?; print -r -- "ARRAY_STATUS=$code"; ${hook === "array" ? fail : "true"}; }`,
        "precmd_functions=(user_precmd)",
      ].join("\n"),
    );
    const id = `hook-${hook}`;
    const action = await start(id, ["touch fail-hook", commandLine], root, "host");
    const result = await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
    assert.equal(result.type === "exited" && result.exitCode, exitCode);
    await wait(() => outputs.get(id)!.includes("parameter not set"));
    const output = outputs.get(id)!;
    const firstNamed = output.indexOf("NAMED_STATUS=0\r\n");
    assert.ok(firstNamed >= 0 && firstNamed < output.indexOf("ARRAY_STATUS=0\r\n"));
    const completed = output.lastIndexOf(`\u001b]633;D;${exitCode};`);
    const named = output.lastIndexOf(`NAMED_STATUS=${exitCode}\r\n`);
    assert.ok(completed >= 0 && completed < named);
    if (hook === "array") assert.ok(named < output.lastIndexOf(`ARRAY_STATUS=${exitCode}\r\n`));
  }

  for (const hook of ["named", "array"] as const) {
    const fail = 'setopt localoptions nounset; print "$ODT_MISSING_HOOK_VALUE"';
    await writeFile(
      join(root, ".zshrc"),
      [
        'PROMPT="fixture> "',
        "HISTSIZE=1000",
        `preexec() { print -r -- "NAMED_ARGS=$#"; ${hook === "named" ? fail : "true"}; }`,
        `user_preexec() { print -r -- "ARRAY_ARGS=$#"; ${hook === "array" ? fail : "true"}; }`,
        "preexec_functions=(user_preexec)",
      ].join("\n"),
    );
    const id = `start-${hook}`;
    await start(id, [command]);
    await wait(() => outputs.get(id)!.includes("SERVER_READY\r\n"));
    assert.equal(activities.get(id)?.restartable, true);
    const output = outputs.get(id)!;
    const started = output.indexOf("\u001b]633;E;");
    const named = output.indexOf("NAMED_ARGS=3\r\n");
    assert.ok(started >= 0 && started < named);
    if (hook === "array") assert.ok(named < output.indexOf("ARRAY_ARGS=3\r\n"));
    assert.ok(output.includes("parameter not set"));
    await Effect.runPromise(engine.restart(id, activities.get(id)!.command));
    await wait(() => outputs.get(id)!.split("SERVER_READY\r\n").length === 3);
  }

  await mkdir(join(root, "hooks"));
  await writeFile(join(root, "hooks/preexec"), 'print -r -- "AUTO_START=$#"\n');
  await writeFile(join(root, "hooks/precmd"), 'local code=$?; print -r -- "AUTO_END=$code"\n');
  await writeFile(
    join(root, ".zshrc"),
    'PROMPT="fixture> "\nfpath=("$HOME/hooks" $fpath)\nautoload -Uz preexec precmd\n',
  );
  const autoload = await start("autoload", ["false"]);
  const loaded = await Effect.runPromise(autoload.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(loaded.type === "exited" && loaded.exitCode, 1);
  await wait(() => outputs.get("autoload")!.includes("AUTO_END=1\r\n"));
  const autoloadOutput = outputs.get("autoload")!;
  assert.ok(autoloadOutput.indexOf("\u001b]633;E;") < autoloadOutput.indexOf("AUTO_START=3\r\n"));
  assert.ok(
    autoloadOutput.lastIndexOf("\u001b]633;D;1;") < autoloadOutput.indexOf("AUTO_END=1\r\n"),
  );
  assert.ok(!autoloadOutput.includes("function definition file not found"));

  await writeFile(
    join(root, ".zshrc"),
    'PROMPT="fixture> "\nfpath=("$HOME/missing")\nautoload -Uz preexec\n',
  );
  const missing = await start("missing-hook", ["true"]);
  const failed = await Effect.runPromise(missing.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(failed.type === "exited" && failed.exitCode, 1);
  assert.ok(outputs.get("missing-hook")!.includes("Fix the preexec function"));
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
