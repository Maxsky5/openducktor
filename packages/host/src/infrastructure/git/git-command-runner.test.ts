import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  createLoadTimeFixtureFolder,
  writeCheckedExecutable,
} from "../../test-support/checked-executable";
import { createDefaultGitRunner, GIT_OUTPUT_ENCODING_FIELD } from "./git-command-runner";

// The fake Git command is written while this file loads, as `writeCheckedExecutable` explains.
const fakeGitFolder = await createLoadTimeFixtureFolder("odt-git-runner-command-");
const fakeGitCommand = path.join(fakeGitFolder, process.platform === "win32" ? "git.cmd" : "git");
if (process.platform === "win32") {
  await writeFile(fakeGitCommand, "@echo off\r\necho fake-git:%~1:%~2:%GIT_TERMINAL_PROMPT%\r\n");
} else {
  await writeCheckedExecutable(
    fakeGitCommand,
    '#!/bin/sh\nprintf \'fake-git:%s:%s:%s\\n\' "$1" "$2" "$GIT_TERMINAL_PROMPT"\n',
  );
}

const withFakeGitCommand = async (run: (root: string, command: string) => Promise<void>) => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-git-runner-"));
  try {
    await run(root, fakeGitCommand);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

describe("createDefaultGitRunner", () => {
  test("runs an explicit Git command through the platform launch path", async () => {
    await withFakeGitCommand(async (root, command) => {
      const runner = createDefaultGitRunner(() => process.env, {
        command,
        platform: process.platform,
      });

      await expect(Effect.runPromise(runner(root, ["one", "two words"]))).resolves.toMatchObject({
        ok: true,
        stdout:
          process.platform === "win32"
            ? "fake-git:one:two words:0\r\n"
            : "fake-git:one:two words:0\n",
      });
    });
  });

  test("resolves Git lazily through the configured discovery function and caches success", async () => {
    await withFakeGitCommand(async (root, command) => {
      let resolveCount = 0;
      const runner = createDefaultGitRunner(() => process.env, {
        platform: process.platform,
        resolveCommand: () =>
          Effect.sync(() => {
            resolveCount += 1;
            return command;
          }),
      });

      await expect(Effect.runPromise(runner(root, ["one", "two words"]))).resolves.toMatchObject({
        ok: true,
      });
      await expect(Effect.runPromise(runner(root, ["alpha", "beta"]))).resolves.toMatchObject({
        ok: true,
      });
      expect(resolveCount).toBe(1);
    });
  });
});

for (const stdin of [undefined, ""]) {
  test(`preserves Git exit statuses with ${stdin === undefined ? "execFile" : "spawn"}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-git-exit-"));
    try {
      await writeFile(path.join(root, "file.txt"), "hello\n");
      const runner = createDefaultGitRunner(() => process.env, { command: "git" });
      for (const [args, code] of [
        [["diff", "--no-index", "--", "file.txt", "file.txt"], 0],
        [["diff", "--no-index", "--", "/dev/null", "file.txt"], 1],
        [["diff", "--no-index", "--", "/dev/null", "missing.txt"], 1],
        [["diff", "--invalid-option"], 129],
      ] as const) {
        const options: Parameters<typeof runner>[2] = { allowFailure: true };
        if (stdin !== undefined) options.stdin = stdin;
        const result = await Effect.runPromise(runner(root, [...args], options));
        expect(result).toMatchObject({ ok: code === 0, exitCode: code });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("a strict read fails on output that is not UTF-8 and keeps the replacement character", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-git-utf8-"));
  try {
    await writeFile(path.join(root, "latin.txt"), Buffer.from("caf\xe9\n", "latin1"));
    await writeFile(path.join(root, "text.txt"), "caf\uFFFD\n");
    const runner = createDefaultGitRunner(() => process.env, { command: "git" });
    const read = (file: string) =>
      Effect.runPromise(
        Effect.flip(
          runner(root, ["diff", "--no-index", "--text", "--", "/dev/null", file], {
            allowFailure: true,
            strictUtf8: true,
          }).pipe(Effect.flatMap((result) => Effect.fail(result))),
        ),
      );

    // `git diff --no-index` exits 1 for a difference, and a strict read still checks stdout.
    expect(await read("latin.txt")).toMatchObject({ field: GIT_OUTPUT_ENCODING_FIELD });
    expect(await read("text.txt")).toMatchObject({
      ok: false,
      stdout: expect.stringContaining("+caf\uFFFD"),
    });
    expect(
      await Effect.runPromise(
        Effect.flip(runner(root, ["hash-object", "--stdin"], { stdin: "", strictUtf8: true })),
      ),
    ).toMatchObject({
      message:
        "A Git read with stdin or a start callback cannot check that its output is UTF-8 text.",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
