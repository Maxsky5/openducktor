import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import type { TerminalNativeFixture } from "./terminal-action-native.fixture";

export async function checkHooks({
  root,
  engine,
  activities,
  outputs,
  start,
  write,
  wait,
  serverCommand,
}: TerminalNativeFixture) {
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
    await wait(() => {
      const output = outputs.get(id)!;
      const completed = output.lastIndexOf(`\u001b]633;D;${exitCode};`);
      return completed >= 0 && output.indexOf("\u001b]633;R;", completed) > completed;
    });
    const output = outputs.get(id)!;
    assert.ok(output.includes("parameter not set"), "The user hook must run");
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
    'PROMPT="fixture> "\nsource() { print USER_SOURCE_FUNCTION; }\n',
  );
  const source = await start("source-hook", ["print ACTION_LOADER_READY"]);
  const sourced = await Effect.runPromise(source.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(sourced.type === "exited" && sourced.exitCode, 0);
  assert.ok(outputs.get("source-hook")!.includes("ACTION_LOADER_READY\r\n"));
  assert.ok(!outputs.get("source-hook")!.includes("USER_SOURCE_FUNCTION\r\n"));
  await write("source-hook", "source any\r");
  await wait(() => outputs.get("source-hook")!.includes("USER_SOURCE_FUNCTION\r\n"));

  await writeFile(
    join(root, ".zshrc"),
    'PROMPT="fixture> "\nfpath=("$HOME/missing")\nautoload -Uz preexec\n',
  );
  const missing = await start("missing-hook", ["true"]);
  const failed = await Effect.runPromise(missing.result.pipe(Effect.timeout("2 seconds")));
  assert.equal(failed.type === "exited" && failed.exitCode, 1);
  assert.ok(outputs.get("missing-hook")!.includes("Fix the preexec function"));
}
