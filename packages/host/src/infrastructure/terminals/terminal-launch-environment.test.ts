import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createTerminalLaunchEnvironment } from "./terminal-launch-environment";

const testIfPosixShellIsAvailable = process.platform === "win32" ? test.skip : test;

testIfPosixShellIsAvailable(
  "uses the host-resolved environment without probing the login shell again",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-terminal-launch-environment-"));
    const probePath = join(root, "login-shell-probed");
    const shellPath = join(root, "fake-shell");
    try {
      await writeFile(shellPath, `#!/bin/sh\nprintf probed > ${JSON.stringify(probePath)}\n`);
      await chmod(shellPath, 0o755);

      const environment = await Effect.runPromise(
        createTerminalLaunchEnvironment({
          processEnv: {
            PATH: "/already/resolved:/usr/bin",
            SHELL: shellPath,
          },
          platform: "darwin",
          readUserShell: () => null,
        })(),
      );

      expect(environment.shell).toBe(shellPath);
      expect(environment.env.PATH).toBe("/already/resolved:/usr/bin");
      expect(await Bun.file(probePath).exists()).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);
