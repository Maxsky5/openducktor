import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { formatTerminalPathInput } from "../application/terminals/terminal-path-input";

import type { TerminalNativeFixture } from "./terminal-action-native.fixture";

async function promptReaderCommand(
  root: string,
  shell: TerminalNativeFixture["shell"],
): Promise<string> {
  const script = join(root, "prompt-reader.sh");
  await writeFile(
    script,
    `trap ': > prompt-read; exit 0' INT
printf 'SERVER_READY\\n'
while IFS= read -r line; do :; done
`,
  );
  return formatTerminalPathInput(shell, ["/bin/sh", script]);
}

export async function checkReady({
  root,
  shell,
  engine,
  activities,
  inputs,
  outputs,
  start,
  write,
  writeRaw,
  exitShell,
  wait,
}: TerminalNativeFixture) {
  const command = await promptReaderCommand(root, shell);
  for (const hook of ["precmd", "widget", "startup", "vared", "widget-error"] as const) {
    await rm(join(root, "prompt-read"), { force: true });
    await writeFile(
      join(root, ".zshrc"),
      [
        'PROMPT="fixture> "',
        "HISTSIZE=1000",
        "read_once=0",
        `user_read() { if (( !read_once )) && ${hook === "startup" ? "true" : '[[ -f "$HOME/prompt-read" ]]'}; then read_once=1; print READER_WAITING; read -k 1 reply; print -r -- "READER_INPUT=$reply"; fi; }`,
        ...(hook === "widget-error"
          ? [
              'user_init() { setopt localoptions nounset; print "$ODT_MISSING_WIDGET_VALUE"; }',
              "zle -N zle-line-init user_init",
            ]
          : hook === "vared"
            ? [
                "user_init() { print -r -- \"USER_WIDGET=$WIDGET:$CONTEXT:$#\"; if [[ $CONTEXT == vared ]]; then user_read; zle -U $'\\n'; fi; }",
                "zle -N zle-line-init user_init",
                'precmd() { if [[ -f "$HOME/prompt-read" ]] && (( !read_once )); then local answer=; vared answer; print VARED_DONE; fi; }',
              ]
            : hook === "widget"
              ? [
                  'user_init() { print -r -- "USER_WIDGET=$WIDGET:$CONTEXT:$#"; user_read; }',
                  "zle -N zle-line-init user_init",
                ]
              : ["precmd() { user_read; }"]),
      ].join("\n"),
    );
    const id = `ready-${hook}`;
    await start(id, [command]);
    if (hook !== "startup") {
      await wait(
        () =>
          outputs.get(id)!.includes("SERVER_READY\r\n") && activities.get(id)?.restartable === true,
      );
    }
    const restart =
      hook === "startup"
        ? null
        : Effect.runPromise(Effect.result(engine.restart(id, activities.get(id)!.command)));
    if (hook !== "widget-error") {
      await wait(() => outputs.get(id)!.includes("READER_WAITING\r\n"));
      // The hook must get our key before the host sends the Action input.
      const written = inputs.get(id)!;
      if (hook === "startup") assert.deepEqual(written, []);
      else assert.equal(written.at(-1), "\u0003");
      await writeRaw(id, "!");
    }
    if (restart !== null) {
      const result = await restart;
      if (result._tag === "Failure") throw result.failure;
    }
    const expectedStarts = hook === "startup" ? 1 : 2;
    await wait(() => outputs.get(id)!.split("SERVER_READY\r\n").length === expectedStarts + 1);
    const output = outputs.get(id)!;
    if (hook !== "widget-error") {
      assert.deepEqual(output.match(/READER_INPUT=.*\r\n/gu), ["READER_INPUT=!\r\n"]);
    }
    const done = output.indexOf(
      hook === "widget-error"
        ? "parameter not set"
        : hook === "vared"
          ? "VARED_DONE\r\n"
          : "READER_INPUT=!\r\n",
    );
    assert.ok(done >= 0 && output.indexOf("\u001b]633;R;", done) > done);
    if (hook === "widget" || hook === "vared")
      assert.ok(output.includes("USER_WIDGET=zle-line-init:start:0\r\n"));
    if (hook === "vared") assert.ok(output.includes("USER_WIDGET=zle-line-init:vared:0\r\n"));
    await write(id, "\u0003");
    await wait(() => !activities.has(id));
    await exitShell(id);
  }
}

export async function checkBuffer({
  root,
  shell,
  engine,
  activities,
  outputs,
  start,
  write,
  writeRaw,
  exitShell,
  wait,
}: TerminalNativeFixture) {
  const command = await promptReaderCommand(root, shell);
  for (const [phase, buffers] of [
    ["initial", ["left", "right", "queued", "pending"]],
    ["restart", ["both", "queued"]],
  ] as const) {
    for (const side of buffers) {
      await rm(join(root, "prompt-read"), { force: true });
      const prefix = "print PRELOADED; ";
      const left = side === "left" || side === "both" ? prefix : "";
      const right = side === "right" || side === "both" ? "; print SUFFIX" : "";
      let setup = `LBUFFER='${left}'; RBUFFER='${right}';`;
      if (side === "queued") setup = `zle -U '${prefix}';`;
      else if (side === "pending")
        setup =
          "if (( !reader_started )); then reader_started=1; print WIDGET_WAITING; read -k 1 trigger; fi;";
      await writeFile(
        join(root, ".zshrc"),
        [
          'PROMPT="fixture> "',
          `user_init() { if ${phase === "initial" ? "true" : '[[ -f "$HOME/prompt-read" ]]'}; then ${setup} fi; }`,
          "zle -N zle-line-init user_init",
          'user_check() { print -rl -- "LEFT=$LBUFFER" "RIGHT=$RBUFFER"; BUFFER=; zle redisplay; }',
          "zle -N user_check",
          'bindkey "^X^B" user_check',
        ].join("\n"),
      );
      const id = `buffer-${phase}-${side}`;
      const started = await start(id, [phase === "initial" ? "print ACTION_RAN" : command]);
      if (side === "pending") {
        await wait(() => outputs.get(id)!.includes("WIDGET_WAITING\r\n"));
        await writeRaw(id, `!${prefix}`);
      }
      if (phase === "initial") {
        const result = await Effect.runPromise(started.result.pipe(Effect.timeout("2 seconds")));
        assert.ok(outputs.get(id)!.includes("Clear it, then run the Action or command again."));
        assert.equal(result.type, "failed");
        assert.ok(
          result.type === "failed" && result.message.includes("line editor already contains text"),
        );
      } else {
        await wait(
          () =>
            outputs.get(id)!.includes("SERVER_READY\r\n") &&
            activities.get(id)?.restartable === true,
        );
        const result = await Effect.runPromise(
          Effect.result(engine.restart(id, activities.get(id)!.command)),
        );
        assert.equal(result._tag, "Failure");
        assert.ok(
          result._tag === "Failure" &&
            result.failure.message.includes("line editor already contains text"),
        );
        assert.equal(outputs.get(id)!.split("SERVER_READY\r\n").length, 2);
      }
      await write(id, "\x18\x02");
      await wait(() =>
        outputs.get(id)!.includes(`LEFT=${side === "right" ? "" : prefix}\r\nRIGHT=${right}\r\n`),
      );
      await write(id, 'printf "PARENT_ALIVE\\n"\r');
      await wait(() => outputs.get(id)!.includes("PARENT_ALIVE\r\n"));
      const output = outputs.get(id)!;
      assert.ok(!output.includes("\r\nPRELOADED\r\n"));
      assert.ok(!output.includes("\r\nACTION_RAN\r\n"));
      assert.ok(!output.includes("\r\nSUFFIX\r\n"));
      // Clear text left by the widget before typing the exit command.
      await write(id, "\x18\x02");
      await exitShell(id);
    }
  }
}
