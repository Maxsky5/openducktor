import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalActivity } from "@openducktor/contracts";
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
try {
  await writeFile(
    join(root, ".zshrc"),
    'PROMPT="fixture> "\nHISTFILE="$HOME/history"\nHISTSIZE=1000\nSAVEHIST=1000\nuser_precmd() { true; }\nprecmd_functions=(user_precmd)\n',
  );
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
  console.log("PASS history: Ctrl+C, Up Arrow, and native history save");

  const server = join(root, "server.cjs");
  await writeFile(
    server,
    'process.on("SIGINT", () => { console.log("SERVER_STOPPING"); setTimeout(() => { console.log("SERVER_STOPPED"); process.exit(0); }, 40); }); console.log("SERVER_CWD=" + process.cwd()); console.log("SERVER_READY"); setInterval(() => {}, 1000);',
  );
  const command = formatTerminalPathInput(shell, [process.execPath, server]);
  const actionRoot = join(root, "action's root");
  await mkdir(join(actionRoot, "target"), { recursive: true });
  const unpadded = await Effect.runPromise(
    launchEnvironment.command(["cd target", "export ODT_LONG_ACTION=", command]),
  );
  const gap = 1000 - new TextEncoder().encode(unpadded.command.interactiveCommand!).byteLength;
  const padding = "xé🙂".repeat(Math.floor(gap / 7)) + "x".repeat(gap % 7);
  await start("restart", ["cd target", `export ODT_LONG_ACTION=${padding}`, command], actionRoot);
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
  assert.deepEqual(
    output
      .split("\u001b]633;E;")
      .slice(1)
      .map((marker) => marker.split("\u0007", 1)[0]!.split(";").at(-1)),
    ["1", "0", "0"],
  );
  const serverDirectory = await realpath(join(actionRoot, "target"));
  assert.equal(output.split(`SERVER_CWD=${serverDirectory}\r\n`).length, 4);
  console.log("PASS restart: relative directory setup restarts twice after each graceful stop");

  const closing = await start("close", [command]);
  await wait(() => outputs.get("close")!.includes("SERVER_READY\r\n"));
  await Effect.runPromise(engine.close("close", true));
  assert.equal((await Effect.runPromise(closing.result)).type, "closed");

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
  await wait(() => outputs.get("state")!.includes(`AFTER=${target}:kept\r\n`));
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
  console.log("PASS state: multiline failure stops later lines and preserves cwd and environment");
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
        startedBy: "user",
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
