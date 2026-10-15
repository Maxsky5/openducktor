import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { formatTerminalPathInput } from "../application/terminals/terminal-path-input";
import type { TerminalCommandLines } from "../application/terminals/terminal-command";
import type { checkReady } from "./terminal-ready-native.fixture";

export async function checkDisplay({
  root,
  shell,
  engine,
  start,
  write,
  wait,
  outputs,
  activities,
}: Parameters<typeof checkReady>[0]) {
  await writeFile(
    join(root, ".zshrc"),
    [
      'PROMPT="fixture> "',
      "HISTSIZE=1000",
      'user_redraw() { if [[ -n $BUFFER ]]; then print -r -- "$WIDGET:$CONTEXT" > "$HOME/redraw"; BUFFER+=" "; fi; }',
      'user_finish() { print -r -- "$WIDGET:$CONTEXT:$#" > "$HOME/widget"; BUFFER+=" "; return 7; }',
      "zle -N zle-line-pre-redraw user_redraw",
      "zle -N zle-line-finish user_finish",
    ].join("\n"),
  );
  const lines: TerminalCommandLines = ["print FIRST", "exit 9"];
  const action = await start("display", lines);
  const result = await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(result.type === "exited" && result.exitCode, 9);
  assert.equal(
    engine.list({ kind: "all" }).find((item) => item.terminalId === "display")?.lifecycle,
    "running",
  );
  assert.equal(await readFile(join(root, "redraw"), "utf8"), "zle-line-pre-redraw:start\n");
  assert.equal(await readFile(join(root, "widget"), "utf8"), "zle-line-finish:start:0\n");
  const screen = await Effect.runPromise(engine.readOutputTail("display", 24));
  assert.ok(screen.includes("fixture> print FIRST"), JSON.stringify(screen));
  assert.ok(screen.includes("exit 9"), JSON.stringify(screen));
  assert.ok(
    !screen.some(
      (line) => line.includes("builtin eval") || line.trim() === "(" || line.trim() === ")",
    ),
  );
  await write("display", "\u001b[A");
  await wait(() => outputs.get("display")!.split("print FIRST").length >= 3);
  const recalled = await Effect.runPromise(engine.readOutputTail("display", 24));
  assert.deepEqual(recalled.slice(-2), ["fixture> print FIRST", "exit 9"]);
  await write("display", "\r");
  await wait(
    () =>
      outputs.get("display")!.split("\u0007FIRST\r\n").length === 3 && !activities.has("display"),
  );
  assert.equal(
    engine.list({ kind: "all" }).find((item) => item.terminalId === "display")?.lifecycle,
    "running",
  );
  const command = formatTerminalPathInput(shell, [
    process.execPath,
    "-e",
    'process.on("SIGINT",()=>process.exit(0)); console.log("DISPLAY_READY"); setInterval(()=>{},1000)',
  ]);
  await start("display-restart", [command]);
  await wait(() => outputs.get("display-restart")!.includes("DISPLAY_READY\r\n"));
  for (const count of [2, 3]) {
    assert.equal(activities.get("display-restart")?.restartable, true);
    assert.equal(activities.get("display-restart")?.command, command);
    await Effect.runPromise(engine.restart("display-restart", command));
    await wait(
      () => outputs.get("display-restart")!.split("DISPLAY_READY\r\n").length === count + 1,
    );
  }
}
