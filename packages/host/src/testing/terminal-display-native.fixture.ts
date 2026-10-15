import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import type { TerminalCommandLines } from "../application/terminals/terminal-command";
import type { checkReady } from "./terminal-ready-native.fixture";

export async function checkDisplay({
  root,
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
      'user_redraw() { [[ -z $BUFFER ]] || print -r -- "$BUFFER" > "$HOME/redraw"; }',
      'user_finish() { print -r -- "$BUFFER" > "$HOME/finish"; print -r -- "$WIDGET:$CONTEXT:$#" > "$HOME/widget"; return 7; }',
      "zle -N zle-line-pre-redraw user_redraw",
      "zle -N zle-line-finish user_finish",
    ].join("\n"),
  );
  const lines: TerminalCommandLines = ["print FIRST", "exit 7"];
  const action = await start("display", lines);
  const result = await Effect.runPromise(action.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(result.type === "exited" && result.exitCode, 7);
  assert.equal(await readFile(join(root, "redraw"), "utf8"), lines.join("\n") + "\n");
  assert.equal(await readFile(join(root, "finish"), "utf8"), lines.join("\n") + "\n");
  assert.equal(await readFile(join(root, "widget"), "utf8"), "zle-line-finish:start:0\n");
  const screen = await Effect.runPromise(engine.readOutputTail("display", 24));
  assert.ok(screen.includes("fixture> print FIRST"), JSON.stringify(screen));
  assert.ok(screen.includes("exit 7"), JSON.stringify(screen));
  assert.ok(
    !screen.some(
      (line) => line.includes("builtin eval") || line.trim() === "(" || line.trim() === ")",
    ),
  );
  await write("display", "\u001b[A");
  await wait(() => outputs.get("display")!.split("print FIRST").length >= 3);
  const recalled = await Effect.runPromise(engine.readOutputTail("display", 24));
  assert.deepEqual(recalled.slice(-2), ["fixture> print FIRST", "exit 7"]);
  await write("display", "\r");
  await wait(
    () =>
      outputs.get("display")!.split("\u0007FIRST\r\n").length === 3 && !activities.has("display"),
  );
  assert.equal(
    engine.list({ kind: "all" }).find((item) => item.terminalId === "display")?.lifecycle,
    "running",
  );
}
