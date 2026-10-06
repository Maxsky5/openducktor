import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { Effect } from "effect";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import type { FilesystemPort } from "../../ports/filesystem-port";
import { createTerminalLaunchPolicy } from "./terminal-launch-policy";

const filesystem: FilesystemPort = {
  homeDirectory: () => "/home/user",
  canonicalize: (path: string) => Effect.succeed(`/canonical${path}`),
  readDirectory: () => Effect.succeed([]),
  readFileBytes: () => Effect.succeed(new Uint8Array()),
  readFileSnapshot: () => Effect.die("not used"),
  replaceFileBytes: () => Effect.die("not used"),
  stat: () => Effect.succeed({ isDirectory: true }),
  exists: () => Effect.succeed(true),
  join: posix.join,
  relative: posix.relative,
  parent: (path) => (path === "/" ? null : posix.dirname(path)),
};

const createFakeShell = async (): Promise<{ root: string; shellPath: string }> => {
  const root = await mkdtemp(join(tmpdir(), "odt-terminal-launch-policy-"));
  const shellPath = join(root, "sh");
  await writeFile(shellPath, "#!/bin/sh\n");
  await chmod(shellPath, 0o755);
  return { root, shellPath };
};

describe("terminal launch policy", () => {
  test("canonicalizes the directory and removes control credentials", async () => {
    const { root, shellPath } = await createFakeShell();
    try {
      const processEnv = {
        ODT_HOST_TOKEN: "host-secret",
        OPENDUCKTOR_APP_TOKEN: "app-secret",
        PATH: "/usr/bin",
        SHELL: shellPath,
      };
      const plan = await Effect.runPromise(
        createTerminalLaunchPolicy({
          filesystem,
          resolveEnvironment: createTerminalLaunchEnvironment({
            readEnv: () => processEnv,
            platform: "darwin",
            readUserShell: () => null,
          }),
        })({ workingDir: "/repo", context: {} }, { columns: 80, rows: 24 }),
      );
      expect(plan.cwd).toBe("/canonical/repo");
      expect(plan.shell).toBe(shellPath);
      expect(plan.args).toEqual(["-l"]);
      expect(plan.env.TERM).toBe("xterm-256color");
      expect(plan.env.ODT_HOST_TOKEN).toBeUndefined();
      expect(plan.env.OPENDUCKTOR_APP_TOKEN).toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects a non-directory and does not select another path", async () => {
    const { root, shellPath } = await createFakeShell();
    try {
      const nonDirectory = { ...filesystem, stat: () => Effect.succeed({ isDirectory: false }) };
      const result = await Effect.runPromiseExit(
        createTerminalLaunchPolicy({
          filesystem: nonDirectory,
          resolveEnvironment: createTerminalLaunchEnvironment({
            readEnv: () => ({ SHELL: shellPath }),
            platform: "darwin",
          }),
        })({ workingDir: "/file", context: {} }, { columns: 80, rows: 24 }),
      );
      expect(result._tag).toBe("Failure");
      expect(String(result)).toContain("working_directory_not_directory");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
