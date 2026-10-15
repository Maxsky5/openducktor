import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TerminalActivity } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  StartedCommandTerminal,
  TerminalCommandLines,
} from "../application/terminals/terminal-command";
import { formatTerminalPathInput } from "../application/terminals/terminal-path-input";
import type { createTerminalSessionEngine } from "../application/terminals/terminal-session-engine";

type Fixture = {
  root: string;
  shell: string;
  engine: ReturnType<typeof createTerminalSessionEngine>;
  activities: Map<string, TerminalActivity>;
  outputs: Map<string, string>;
  start(id: string, lines: TerminalCommandLines): Promise<StartedCommandTerminal>;
  write(id: string, text: string): Promise<void>;
  wait(check: () => boolean): Promise<void>;
};

export async function checkReady({
  root,
  shell,
  engine,
  activities,
  outputs,
  start,
  wait,
}: Fixture) {
  const server = join(root, "reader.cjs");
  await writeFile(
    server,
    'process.on("SIGINT", () => { require("node:fs").writeFileSync("prompt-read", ""); process.exit(0); }); console.log("SERVER_READY"); setInterval(() => {}, 1000);',
  );
  const command = formatTerminalPathInput(shell, [process.execPath, server]);
  for (const hook of ["precmd", "widget", "startup", "vared", "widget-error"] as const) {
    await rm(join(root, "prompt-read"), { force: true });
    await writeFile(
      join(root, ".zshrc"),
      [
        'PROMPT="fixture> "',
        "HISTSIZE=1000",
        "read_once=0",
        `user_read() { if (( !read_once )) && ${hook === "startup" ? "true" : '[[ -f "$HOME/prompt-read" ]]'}; then read_once=1; print READER_WAITING; if read -k 1 -t 0.15 reply; then print -r -- "READER_STOLE=$reply"; fi; print READER_DONE; fi; }`,
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
    await wait(() => outputs.get(id)!.includes("SERVER_READY\r\n"));
    if (hook !== "startup") {
      await Effect.runPromise(engine.restart(id, activities.get(id)!.command));
      await wait(() =>
        outputs
          .get(id)!
          .includes(hook === "widget-error" ? "parameter not set" : "READER_DONE\r\n"),
      );
    }
    const output = outputs.get(id)!;
    assert.ok(!output.includes("READER_STOLE="));
    const done = output.indexOf(
      hook === "widget-error"
        ? "parameter not set"
        : hook === "vared"
          ? "VARED_DONE\r\n"
          : "READER_DONE\r\n",
    );
    assert.ok(done >= 0 && output.indexOf("\u001b]633;R;", done) > done);
    if (hook === "widget" || hook === "vared")
      assert.ok(output.includes("USER_WIDGET=zle-line-init:start:0\r\n"));
    if (hook === "vared") assert.ok(output.includes("USER_WIDGET=zle-line-init:vared:0\r\n"));
    if (hook !== "startup")
      await wait(() => outputs.get(id)!.split("SERVER_READY\r\n").length === 3);
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
  wait,
}: Fixture) {
  const server = join(root, "buffer-server.cjs");
  await writeFile(
    server,
    'process.on("SIGINT", () => { require("node:fs").writeFileSync("prompt-read", ""); process.exit(0); }); console.log("SERVER_READY"); setInterval(() => {}, 1000);',
  );
  const command = formatTerminalPathInput(shell, [process.execPath, server]);
  for (const phase of ["initial", "restart"]) {
    for (const side of ["left", "right", "both"]) {
      await rm(join(root, "prompt-read"), { force: true });
      const left = side === "right" ? "" : "print PRELOADED; ";
      const right = side === "left" ? "" : "; print SUFFIX";
      await writeFile(
        join(root, ".zshrc"),
        [
          'PROMPT="fixture> "',
          `user_init() { if ${phase === "initial" ? "true" : '[[ -f "$HOME/prompt-read" ]]'}; then LBUFFER='${left}'; RBUFFER='${right}'; fi; }`,
          "zle -N zle-line-init user_init",
          'user_check() { print -rl -- "LEFT=$LBUFFER" "RIGHT=$RBUFFER"; BUFFER=; zle redisplay; }',
          "zle -N user_check",
          'bindkey "^X^B" user_check',
        ].join("\n"),
      );
      const id = `buffer-${phase}-${side}`;
      const started = await start(id, [phase === "initial" ? "print ACTION_RAN" : command]);
      if (phase === "initial") {
        const result = await Effect.runPromise(started.result.pipe(Effect.timeout("2 seconds")));
        assert.ok(outputs.get(id)!.includes("Clear it, then run the Action or command again."));
        assert.equal(result.type, "failed");
        assert.ok(
          result.type === "failed" && result.message.includes("line editor already contains text"),
        );
      } else {
        await wait(() => outputs.get(id)!.includes("SERVER_READY\r\n"));
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
      await wait(() => outputs.get(id)!.includes(`LEFT=${left}\r\nRIGHT=${right}\r\n`));
      await write(id, 'printf "PARENT_ALIVE\\n"\r');
      await wait(() => outputs.get(id)!.includes("PARENT_ALIVE\r\n"));
      const output = outputs.get(id)!;
      assert.ok(!output.includes("\r\nPRELOADED\r\n"));
      assert.ok(!output.includes("\r\nACTION_RAN\r\n"));
      assert.ok(!output.includes("\r\nSUFFIX\r\n"));
    }
  }
}
