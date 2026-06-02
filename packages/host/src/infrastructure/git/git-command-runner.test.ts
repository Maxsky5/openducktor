import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createDefaultGitRunner } from "./git-command-runner";

const withFakeGitCommand = async (run: (root: string, command: string) => Promise<void>) => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-git-runner-"));
  try {
    const command =
      process.platform === "win32" ? path.join(root, "git.cmd") : path.join(root, "git");

    if (process.platform === "win32") {
      await writeFile(command, "@echo off\r\necho fake-git:%~1:%~2:%GIT_TERMINAL_PROMPT%\r\n");
    } else {
      await writeFile(
        command,
        '#!/bin/sh\nprintf \'fake-git:%s:%s:%s\\n\' "$1" "$2" "$GIT_TERMINAL_PROMPT"\n',
      );
      await chmod(command, 0o755);
    }

    await run(root, command);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

describe("createDefaultGitRunner", () => {
  test("runs an explicit Git command through the platform launch path", async () => {
    await withFakeGitCommand(async (root, command) => {
      const runner = createDefaultGitRunner(process.env, {
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
      const runner = createDefaultGitRunner(process.env, {
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
