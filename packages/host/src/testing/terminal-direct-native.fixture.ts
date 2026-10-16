import assert from "node:assert/strict";
import { Terminal } from "@xterm/headless";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import type { TerminalNativeFixture } from "./terminal-action-native.fixture";

export async function checkDirect({
  root,
  engine,
  start,
  write,
  wait,
  outputs,
  inputs,
  screens,
  readScreen,
  activities,
  serverCommand,
}: TerminalNativeFixture) {
  await writeFile(
    join(root, ".zshrc"),
    [
      'PROMPT="%F{green}fixture%f> "',
      "HISTSIZE=1000",
      "SAVEHIST=1000",
      'HISTFILE="$HOME/history"',
      "bindkey -e",
      "zmodload zsh/parameter",
      'user_redraw() { print -r -- "$WIDGET:$CONTEXT" > "$HOME/redraw"; }',
      'user_finish() { print -r -- "$WIDGET:$CONTEXT:$#" > "$HOME/widget"; }',
      'inspect_line() { print -rl -- "$CURSOR" "$BUFFER" > "$HOME/cursor"; print -rl -- "${history[@]}" > "$HOME/last-command"; builtin printf \'\\033]777;INSPECTED\\007\'; }',
      "zle -N zle-line-pre-redraw user_redraw",
      "zle -N zle-line-finish user_finish",
      "zle -N inspect_line",
      "bindkey '^G' inspect_line",
    ].join("\n"),
  );
  const command = `ODT_VALUE='${"wrapped-é-".repeat(20)}' ${await serverCommand()}`;
  await start("direct", [command]);
  await wait(() => outputs.get("direct")!.includes("SERVER_READY\r\n"));
  assert.equal(inputs.get("direct")![0], `\u001b[200~${command}\u001b[201~\r`);
  for (const count of [2, 3]) {
    await write("direct", "\u0003");
    await wait(() => !activities.has("direct"));
    const before = outputs.get("direct")!.split("INSPECTED").length;
    await write("direct", "\u001b[A\u0007");
    await wait(() => outputs.get("direct")!.split("INSPECTED").length > before);
    assert.equal(
      (await readFile(join(root, "last-command"), "utf8")).split("\n").includes(command),
      true,
      "History must contain the original direct command",
    );
    assert.equal(
      (await readFile(join(root, "last-command"), "utf8")).includes("(\n"),
      false,
      "History must not contain an Action wrapper",
    );
    assert.equal(
      await readFile(join(root, "cursor"), "utf8"),
      `${Array.from(command).length + count - 2}\n${command}${" ".repeat(count - 2)}\n`,
    );
    await readScreen("direct");
    const screen = new Terminal({ cols: 120, rows: 24, allowProposedApi: true });
    try {
      await new Promise<void>((resolve) =>
        screen.write(screens.get("direct")!.snapshot().payload, resolve),
      );
      const buffer = screen.buffer.active;
      const row = buffer.baseY + buffer.cursorY;
      const line = buffer.getLine(row)!;
      let end = line.length;
      while (end > 0 && line.getCell(end - 1)!.getChars() === "") end--;
      assert.equal(
        buffer.cursorX,
        end + count - 2,
        "Painted cursor must follow the recalled command",
      );
      for (let index = row + 1; index < buffer.length; index++)
        assert.equal(buffer.getLine(index)!.translateToString(true), "");
    } finally {
      screen.dispose();
    }
    await write("direct", " \r");
    await wait(() => outputs.get("direct")!.split("SERVER_READY\r\n").length === count + 1);
  }
  await Effect.runPromise(engine.restart("direct", activities.get("direct")!.command));
  await wait(() => outputs.get("direct")!.split("SERVER_READY\r\n").length === 5);
  assert.equal(inputs.get("direct")!.at(-1), `\u001b[200~${command}  \u001b[201~\r`);
  assert.equal(await readFile(join(root, "redraw"), "utf8"), "zle-line-pre-redraw:start\n");
  assert.equal(await readFile(join(root, "widget"), "utf8"), "zle-line-finish:start:0\n");
  await writeFile(
    join(root, ".zshrc"),
    [
      'PROMPT="fixture> "',
      "HISTSIZE=1000",
      'user_finish() { BUFFER+=" widget-tail"; }',
      "zle -N zle-line-finish user_finish",
    ].join("\n"),
  );
  const longCommand = `ODT_VALUE='${"x".repeat(1200)}' ${await serverCommand()}`;
  await start("widget-edit", [longCommand]);
  await wait(() => outputs.get("widget-edit")!.includes("SERVER_READY\r\n"));
  await Effect.runPromise(engine.restart("widget-edit", activities.get("widget-edit")!.command));
  assert.equal(
    inputs.get("widget-edit")!.at(-1),
    `\u001b[200~${longCommand} widget-tail\u001b[201~\r`,
  );
  await wait(() => outputs.get("widget-edit")!.split("SERVER_READY\r\n").length === 3);
}
