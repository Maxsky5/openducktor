import { describe, expect, test } from "bun:test";
import { accessSync, constants } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  createProcessEnvironment,
  normalizeProcessEnvironment,
  pathEnvironmentValue,
  sanitizeChildProcessEnvironment,
} from "./process-environment";

const testIfPosixShellIsAvailable = process.platform === "win32" ? test.skip : test;
const executablePath = (paths: string[]): string | null => {
  for (const candidate of paths) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Check the next platform path.
    }
  }
  return null;
};
const bashPath = executablePath(["/bin/bash", "/usr/bin/bash"]);
const cshPath = executablePath(["/bin/tcsh", "/bin/csh", "/usr/bin/tcsh", "/usr/bin/csh"]);
const testIfBashIsAvailable = bashPath ? test : test.skip;
const testIfCshIsAvailable = cshPath ? test : test.skip;

const resolveProcessEnvironment = async (
  input: Parameters<typeof createProcessEnvironment>[0],
): Promise<NodeJS.ProcessEnv> =>
  (await Effect.runPromise(createProcessEnvironment(input))).environment;
const loginShellPath = (pathValue: string) => () => Effect.succeed(pathValue);

const writeFakeLoginShell = async (shellPath: string, pathValue: string): Promise<void> => {
  await writeFile(
    shellPath,
    `#!/bin/sh\nprintf 'profile noise\\0__OPENDUCKTOR_ENV_START__\\0USER=max\\0PATH=${pathValue}\\0'\n`,
  );
  await chmod(shellPath, 0o755);
};

describe("createProcessEnvironment", () => {
  test("merges the macOS login shell PATH before the inherited GUI PATH", async () => {
    const env = await resolveProcessEnvironment({
      baseEnv: { PATH: "/usr/bin:/bin" },
      platform: "darwin",
      readLoginShellPath: loginShellPath("/opt/homebrew/bin:/usr/bin"),
    });

    expect(env.PATH?.split(":")).toEqual(["/opt/homebrew/bin", "/usr/bin", "/bin"]);
  });

  test("merges the Linux login shell PATH before the inherited GUI PATH", async () => {
    const env = await resolveProcessEnvironment({
      baseEnv: { PATH: "/usr/bin:/bin" },
      platform: "linux",
      readLoginShellPath: loginShellPath("/home/dev/.local/bin:/usr/bin"),
    });

    expect(env.PATH?.split(":")).toEqual(["/home/dev/.local/bin", "/usr/bin", "/bin"]);
  });

  test("does not read a login shell PATH on Windows", async () => {
    const resolution = await Effect.runPromise(
      createProcessEnvironment({
        baseEnv: { Path: "C:\\Windows\\System32" },
        platform: "win32",
        readLoginShellPath: () => {
          throw new Error("login shell should not be read on Windows");
        },
      }),
    );

    expect(resolution).toEqual({
      environment: { Path: "C:\\Windows\\System32" },
      error: null,
    });
  });

  test("does not mutate the caller environment object", async () => {
    const baseEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    const env = await resolveProcessEnvironment({
      baseEnv,
      platform: "darwin",
      readLoginShellPath: loginShellPath("/opt/homebrew/bin"),
    });

    expect(baseEnv.PATH).toBe("/usr/bin:/bin");
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });

  test("normalizes Windows PATH casing without losing explicit PATH overrides", async () => {
    const baseEnv: NodeJS.ProcessEnv = {
      Path: "C:\\Windows\\System32",
      PATH: "C:\\Tools\\bin",
    };

    const env = await resolveProcessEnvironment({
      baseEnv,
      platform: "win32",
      readLoginShellPath: () => {
        throw new Error("login shell should not be read on Windows");
      },
    });

    expect(pathEnvironmentValue(baseEnv, "win32")).toBe("C:\\Tools\\bin");
    expect(env).toMatchObject({ Path: "C:\\Tools\\bin" });
    expect(env.PATH).toBeUndefined();
  });

  test("sets SHELL to the resolved account shell", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-process-environment-"));
    const shellPath = path.join(root, "account-shell");
    try {
      await writeFakeLoginShell(shellPath, "/opt/account:/usr/bin");

      const env = await resolveProcessEnvironment({
        baseEnv: { SHELL: "/bin/bash", PATH: "/usr/bin:/bin" },
        platform: "darwin",
        readUserShell: () => shellPath,
        readLoginShellPath: loginShellPath("/usr/bin:/bin"),
      });

      expect(env.SHELL).toBe(shellPath);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("reports an unusable shell instead of keeping the inherited PATH", async () => {
    const resolution = await Effect.runPromise(
      createProcessEnvironment({
        baseEnv: { SHELL: "bash", PATH: "/usr/bin:/bin" },
        platform: "linux",
        readUserShell: () => null,
      }),
    );

    expect(resolution.error).toMatchObject({
      _tag: "ProcessEnvironmentError",
      reason: "shell_unavailable",
      shell: "bash",
    });
    expect(resolution.environment).toEqual({ SHELL: "bash" });
  });

  testIfPosixShellIsAvailable(
    "falls back to the inherited SHELL when the account shell is not executable",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-process-environment-"));
      const accountShellPath = path.join(root, "account-shell");
      const configuredShellPath = path.join(root, "configured-shell");
      try {
        await writeFile(accountShellPath, "#!/bin/sh\n");
        await chmod(accountShellPath, 0o644);
        await writeFakeLoginShell(configuredShellPath, "/opt/configured:/usr/bin");

        const env = await resolveProcessEnvironment({
          baseEnv: { SHELL: configuredShellPath, PATH: "/usr/bin:/bin" },
          platform: "linux",
          readUserShell: () => accountShellPath,
          readLoginShellPath: loginShellPath("/usr/bin:/bin"),
        });

        expect(env.SHELL).toBe(configuredShellPath);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  test("falls back to the inherited SHELL when the account shell is a nologin shell", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-process-environment-"));
    const accountShellPath = path.join(root, "nologin");
    const configuredShellPath = path.join(root, "configured-shell");
    try {
      await writeFakeLoginShell(accountShellPath, "/opt/account:/usr/bin");
      await writeFakeLoginShell(configuredShellPath, "/opt/configured:/usr/bin");

      const env = await resolveProcessEnvironment({
        baseEnv: { SHELL: configuredShellPath, PATH: "/usr/bin:/bin" },
        platform: "linux",
        readUserShell: () => accountShellPath,
        readLoginShellPath: loginShellPath("/usr/bin:/bin"),
      });

      expect(env.SHELL).toBe(configuredShellPath);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("falls back to the inherited SHELL when the account shell does not exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-process-environment-"));
    const configuredShellPath = path.join(root, "configured-shell");
    try {
      await writeFakeLoginShell(configuredShellPath, "/opt/configured:/usr/bin");

      const env = await resolveProcessEnvironment({
        baseEnv: { SHELL: configuredShellPath, PATH: "/usr/bin:/bin" },
        platform: "linux",
        readUserShell: () => path.join(root, "missing-shell"),
        readLoginShellPath: loginShellPath("/usr/bin:/bin"),
      });

      expect(env.SHELL).toBe(configuredShellPath);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  testIfPosixShellIsAvailable(
    "reads PATH from the account login shell before the SHELL value",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-login-shell-path-"));
      const accountShellPath = path.join(root, "account-shell");
      const configuredShellPath = path.join(root, "configured-shell");
      try {
        await writeFakeLoginShell(accountShellPath, "/opt/account:/usr/bin");
        await writeFakeLoginShell(configuredShellPath, "/opt/configured:/usr/bin");

        const env = await resolveProcessEnvironment({
          baseEnv: { SHELL: configuredShellPath, PATH: "/usr/bin:/bin" },
          platform: "darwin",
          readUserShell: () => accountShellPath,
        });

        expect(env.PATH?.split(":")).toEqual(["/opt/account", "/usr/bin", "/bin"]);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  testIfPosixShellIsAvailable(
    "falls back to the SHELL value when the account shell is unavailable",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-login-shell-path-"));
      const shellPath = path.join(root, "fake-shell");
      try {
        await writeFakeLoginShell(shellPath, "/opt/bin:/usr/bin");

        const env = await resolveProcessEnvironment({
          baseEnv: { SHELL: shellPath, PATH: "/usr/bin:/bin" },
          platform: "darwin",
          readUserShell: () => null,
        });

        expect(env.PATH?.split(":")).toEqual(["/opt/bin", "/usr/bin", "/bin"]);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  testIfPosixShellIsAvailable(
    "matches the PATH from an interactive login fixture shell",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-interactive-login-shell-"));
      const shellPath = path.join(root, "tcsh");
      try {
        await writeFile(path.join(root, ".zshrc"), 'export PATH="/fixture/zshrc-only:$PATH"\n');
        await writeFile(
          shellPath,
          '#!/bin/sh\ncase "$1" in *l*) exit 64 ;; esac\ncase "$1" in *i*) . "$HOME/.zshrc" ;; esac\nexec /bin/sh -c "$2"\n',
        );
        await chmod(shellPath, 0o755);
        const baseEnv = {
          HOME: root,
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          USER: "fixture",
        };
        const expectedProcess = Bun.spawn([shellPath, "-ic", 'printf "%s" "$PATH"'], {
          argv0: `-${path.basename(shellPath)}`,
          env: { ...baseEnv, SHELL: shellPath, TERM: "dumb" },
          stdout: "pipe",
        });
        const expectedPath = await new Response(expectedProcess.stdout).text();
        expect(await expectedProcess.exited).toBe(0);

        const resolution = await Effect.runPromise(
          createProcessEnvironment({
            baseEnv,
            platform: "darwin",
            readUserShell: () => shellPath,
          }),
        );

        expect(resolution.error).toBeNull();
        expect(resolution.environment.PATH).toBe(expectedPath);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  testIfBashIsAvailable("reads PATH from an interactive Bash login shell", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-bash-login-shell-"));
    try {
      await writeFile(
        path.join(root, ".bash_profile"),
        'case "$-" in *i*) export PATH="/fixture/bash-interactive:$PATH" ;; esac\n',
      );
      const resolution = await Effect.runPromise(
        createProcessEnvironment({
          baseEnv: { HOME: root, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", USER: "fixture" },
          platform: "linux",
          readUserShell: () => bashPath,
        }),
      );

      expect(resolution.error).toBeNull();
      expect(resolution.environment.PATH?.split(":")[0]).toBe("/fixture/bash-interactive");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  testIfCshIsAvailable("reads PATH from an interactive csh-family login shell", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-csh-login-shell-"));
    try {
      await writeFile(path.join(root, ".login"), 'setenv PATH "/fixture/csh-login:$PATH"\n');
      const resolution = await Effect.runPromise(
        createProcessEnvironment({
          baseEnv: { HOME: root, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", USER: "fixture" },
          platform: "darwin",
          readUserShell: () => cshPath,
        }),
      );

      expect(resolution.error).toBeNull();
      expect(resolution.environment.PATH?.split(":")[0]).toBe("/fixture/csh-login");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  testIfPosixShellIsAvailable(
    "returns a typed diagnostic and removes the GUI PATH when the probe exits non-zero",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-failed-login-shell-"));
      const shellPath = path.join(root, "fixture-shell");
      try {
        await writeFile(shellPath, "#!/bin/sh\nexit 17\n");
        await chmod(shellPath, 0o755);

        const resolution = await Effect.runPromise(
          createProcessEnvironment({
            baseEnv: { HOME: root, PATH: "/gui/bin:/usr/bin" },
            platform: "linux",
            readUserShell: () => shellPath,
          }),
        );

        expect(resolution.error).toMatchObject({
          _tag: "ProcessEnvironmentError",
          reason: "unexpected_exit",
          shell: shellPath,
        });
        expect(resolution.error?.message).toContain("exit code 17");
        expect(resolution.environment.PATH).toBeUndefined();
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  testIfPosixShellIsAvailable(
    "times out asynchronously with an actionable typed diagnostic",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-timeout-login-shell-"));
      const shellPath = path.join(root, "fixture-shell");
      try {
        await writeFile(shellPath, "#!/bin/sh\nsleep 1\n");
        await chmod(shellPath, 0o755);
        let eventLoopAdvanced = false;
        const resolutionPromise = Effect.runPromise(
          createProcessEnvironment({
            baseEnv: { HOME: root, PATH: "/gui/bin:/usr/bin" },
            loginShellTimeoutMs: 30,
            platform: "linux",
            readUserShell: () => shellPath,
          }),
        );
        setTimeout(() => {
          eventLoopAdvanced = true;
        }, 0);

        const resolution = await resolutionPromise;

        expect(eventLoopAdvanced).toBe(true);
        expect(resolution.error).toMatchObject({
          _tag: "ProcessEnvironmentError",
          reason: "timed_out",
          shell: shellPath,
        });
        expect(resolution.error?.message).toContain("wait for input");
        expect(resolution.environment.PATH).toBeUndefined();
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );
});

describe("normalizeProcessEnvironment", () => {
  test("deduplicates Windows PATH keys before spawning child processes", () => {
    expect(
      normalizeProcessEnvironment(
        {
          Path: "C:\\Windows",
          PATH: "C:\\Tools",
          PaTh: "C:\\Other",
        },
        "win32",
      ),
    ).toEqual({ Path: "C:\\Tools" });
  });
});

describe("sanitizeChildProcessEnvironment", () => {
  test("removes host-control values without mutating the resolved environment", () => {
    const resolvedEnvironment: NodeJS.ProcessEnv = {
      PATH: "/already/resolved:/usr/bin",
      ODT_HOST_TOKEN: "host-secret",
      ODT_HOST_TOKEN_FILE: "/tmp/host-token",
      OPENDUCKTOR_APP_TOKEN: "app-secret",
      USER_SETTING: "preserved",
    };

    const childEnvironment = sanitizeChildProcessEnvironment(resolvedEnvironment, "darwin");

    expect(childEnvironment).toEqual({
      PATH: "/already/resolved:/usr/bin",
      USER_SETTING: "preserved",
    });
    expect(resolvedEnvironment.ODT_HOST_TOKEN).toBe("host-secret");
  });

  test("removes host-control values case-insensitively on Windows", () => {
    expect(
      sanitizeChildProcessEnvironment(
        {
          Path: "C:\\Windows",
          odt_host_token: "host-secret",
        },
        "win32",
      ),
    ).toEqual({ Path: "C:\\Windows" });
  });
});
