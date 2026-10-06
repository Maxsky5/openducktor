import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createTerminalLaunchEnvironment } from "./terminal-launch-environment";

const testIfPosixShellIsAvailable = process.platform === "win32" ? test.skip : test;

const resolveEnvironment = (input: Parameters<typeof createTerminalLaunchEnvironment>[0]) =>
  Effect.runPromise(createTerminalLaunchEnvironment(input)());

testIfPosixShellIsAvailable(
  "uses the host-resolved environment without probing the login shell again",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-terminal-launch-environment-"));
    const probePath = join(root, "login-shell-probed");
    const shellPath = join(root, "fake-shell");
    try {
      await writeFile(shellPath, `#!/bin/sh\nprintf probed > ${JSON.stringify(probePath)}\n`);
      await chmod(shellPath, 0o755);

      const environment = await resolveEnvironment({
        readEnv: () => ({
          PATH: "/already/resolved:/usr/bin",
          SHELL: shellPath,
        }),
        platform: "darwin",
        readUserShell: () => null,
      });

      expect(environment.shell).toBe(shellPath);
      expect(environment.env.PATH).toBe("/already/resolved:/usr/bin");
      expect(await Bun.file(probePath).exists()).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);

testIfPosixShellIsAvailable(
  "prefers the account login shell over the inherited SHELL value",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-terminal-launch-environment-"));
    const shellPath = join(root, "account-shell");
    try {
      await writeFile(shellPath, "#!/bin/sh\n");
      await chmod(shellPath, 0o755);

      const environment = await resolveEnvironment({
        readEnv: () => ({
          PATH: "/usr/bin",
          SHELL: "/bin/bash",
        }),
        platform: "linux",
        readUserShell: () => shellPath,
      });

      expect(environment.shell).toBe(shellPath);
      expect(environment.env.SHELL).toBe(shellPath);
      expect(environment.env.TERM).toBe("xterm-256color");
      expect(environment.env.COLORTERM).toBe("truecolor");
      expect(environment.args).toEqual(["-l"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);

testIfPosixShellIsAvailable(
  "falls back to the inherited SHELL value when the account shell is unavailable",
  async () => {
    const environment = await resolveEnvironment({
      readEnv: () => ({
        PATH: "/usr/bin",
        SHELL: "/bin/bash",
      }),
      platform: "linux",
      readUserShell: () => null,
    });

    expect(environment.shell).toBe("/bin/bash");
    expect(environment.env.SHELL).toBe("/bin/bash");
  },
);

testIfPosixShellIsAvailable(
  "falls back to the inherited SHELL value when the account shell is not absolute",
  async () => {
    const environment = await resolveEnvironment({
      readEnv: () => ({
        PATH: "/usr/bin",
        SHELL: "/bin/bash",
      }),
      platform: "linux",
      readUserShell: () => "zsh",
    });

    expect(environment.shell).toBe("/bin/bash");
    expect(environment.env.SHELL).toBe("/bin/bash");
  },
);

testIfPosixShellIsAvailable("fails when neither shell value is absolute", async () => {
  const failure = await Effect.runPromise(
    Effect.flip(
      createTerminalLaunchEnvironment({
        readEnv: () => ({
          PATH: "/usr/bin",
          SHELL: "bash",
        }),
        platform: "linux",
        readUserShell: () => "zsh",
      })(),
    ),
  );

  expect(failure.code).toBe("shell_unavailable");
});

test("uses ComSpec for Windows terminals", async () => {
  const environment = await resolveEnvironment({
    readEnv: () => ({ ComSpec: "/windows/system32/cmd.exe", Path: "/windows/system32" }),
    platform: "win32",
  });

  expect(environment.shell).toBe("/windows/system32/cmd.exe");
  expect(environment.args).toEqual([]);
});

test("falls back to the account shell for Windows terminals", async () => {
  const environment = await resolveEnvironment({
    readEnv: () => ({ Path: "/windows/system32" }),
    platform: "win32",
    readUserShell: () => "/windows/system32/windows-powershell.exe",
  });

  expect(environment.shell).toBe("/windows/system32/windows-powershell.exe");
  expect(environment.args).toEqual([]);
});

test("fails when Windows has no absolute shell", async () => {
  const failure = await Effect.runPromise(
    Effect.flip(
      createTerminalLaunchEnvironment({
        readEnv: () => ({ Path: "/windows/system32" }),
        platform: "win32",
        readUserShell: () => "powershell.exe",
      })(),
    ),
  );

  expect(failure.code).toBe("shell_unavailable");
});
