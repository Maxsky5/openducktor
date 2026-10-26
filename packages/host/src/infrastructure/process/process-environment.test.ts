import { describe, expect, test } from "bun:test";
import { accessSync, constants, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  createProcessEnvironment,
  normalizeProcessEnvironment,
  pathEnvironmentValue,
  sanitizeChildProcessEnvironment,
} from "./process-environment";
import {
  createLoadTimeFixtureFolder,
  writeCheckedExecutable,
} from "../../test-support/checked-executable";
import { processIsAlive } from "./process-tree";

const testIfPosixShellIsAvailable = process.platform === "win32" ? test.skip : test;
const executablePath = (paths: string[]): string | null => {
  for (const candidate of paths) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
};
const bashPath = executablePath(["/bin/bash", "/usr/bin/bash"]);
const cshPath = executablePath(["/bin/tcsh", "/bin/csh", "/usr/bin/tcsh", "/usr/bin/csh"]);
const testIfBashIsAvailable = bashPath ? test : test.skip;
const testIfCshIsAvailable = cshPath ? test : test.skip;

const waitFor = async (check: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for the process to stop.");
    }
    await Bun.sleep(10);
  }
};

const processHasStopped = (pid: number): boolean => {
  if (!processIsAlive(pid)) {
    return true;
  }
  if (process.platform !== "linux") {
    return false;
  }

  try {
    // Linux reports zombies as alive until their parent reaps them.
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
  } catch {
    return !processIsAlive(pid);
  }
};

const stopChild = (pid: number | null): void => {
  if (pid === null) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (cause) {
    // The probe can stop the child before test cleanup sends its signal.
    if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause;
  }
};

const resolveProcessEnvironment = async (
  input: Parameters<typeof createProcessEnvironment>[0],
): Promise<NodeJS.ProcessEnv> =>
  (await Effect.runPromise(createProcessEnvironment(input))).environment;
const loginShellPath = (pathValue: string) => () => Effect.succeed(pathValue);

// The fixture shells are written while this file loads, as `writeCheckedExecutable` explains. Each
// shell has its own folder, as the probe reads some shell names.
const fixtureRoot = await createLoadTimeFixtureFolder("odt-process-environment-shells-");

const fixtureShell = async (folder: string, name: string, script: string): Promise<string> => {
  await mkdir(path.join(fixtureRoot, folder));
  const shellPath = path.join(fixtureRoot, folder, name);
  await writeCheckedExecutable(shellPath, script);
  return shellPath;
};
const fakeLoginShell = (folder: string, name: string, pathValue: string): Promise<string> =>
  fixtureShell(
    folder,
    name,
    `#!/bin/sh\nprintf 'profile noise\\0'\nexport PATH="${pathValue}"\nexec /bin/sh -c "$2"\n`,
  );

const shells = {
  account: await fakeLoginShell("account", "account-shell", "/opt/account:/usr/bin"),
  configured: await fakeLoginShell("configured", "configured-shell", "/opt/configured:/usr/bin"),
  nologin: await fakeLoginShell("nologin", "nologin", "/opt/account:/usr/bin"),
  fallback: await fakeLoginShell("fallback", "fake-shell", "/opt/bin:/usr/bin"),
  endMarker: await fakeLoginShell(
    "end-marker",
    "fixture-shell",
    "/first:/tmp/__OPENDUCKTOR_ENV_END__",
  ),
  interactiveTcsh: await fixtureShell(
    "interactive",
    "tcsh",
    '#!/bin/sh\ncase "$1" in *l*) exit 64 ;; esac\ncase "$1" in *i*) . "$HOME/.zshrc" ;; esac\nexec /bin/sh -c "$2"\n',
  ),
  zdotdir: await fixtureShell(
    "zdotdir",
    "fixture-shell",
    '#!/bin/sh\n[ -z "$ODT_HOST_TOKEN" ] || exit 23\n. "$ZDOTDIR/.zshrc"\nexec /bin/sh -c "$2"\n',
  ),
  failing: await fixtureShell("failing", "fixture-shell", "#!/bin/sh\nexit 17\n"),
  noPath: await fixtureShell("no-path", "fixture-shell", '#!/bin/sh\nunset PATH\neval "$2"\n'),
  markerless: await fixtureShell("markerless", "fixture-shell", "#!/bin/sh\nexit 0\n"),
  markerlessChild: await fixtureShell(
    "markerless-child",
    "fixture-shell",
    '#!/bin/sh\nsleep 5 &\nprintf \'%s\' "$!" > "$HOME/child.pid"\nexit 0\n',
  ),
  largeOutput: await fixtureShell(
    "large-output",
    "fixture-shell",
    '#!/bin/sh\ni=0\nwhile [ "$i" -lt 1025 ]; do\n  printf \'%1024s\' x\n  i=$((i + 1))\ndone\nexec /bin/sh -c "$2"\n',
  ),
  slow: await fixtureShell(
    "slow",
    "fixture-shell",
    '#!/bin/sh\nsleep 5 &\nprintf \'%s\' "$!" > "$HOME/child.pid"\nsleep 5\n',
  ),
  backgroundChild: await fixtureShell(
    "background-child",
    "fixture-shell",
    `#!/bin/sh\nexport PATH="/fixture/background:$PATH"\nsleep 5 &\nprintf '%s' "$!" > "$HOME/child.pid"\nexec /bin/sh -c "$2"\n`,
  ),
};

describe("createProcessEnvironment", () => {
  test("merges the macOS login shell PATH before the inherited GUI PATH", async () => {
    const env = await resolveProcessEnvironment({
      baseEnv: { PATH: "/usr/bin:/bin" },
      platform: "darwin",
      readLoginShellPath: loginShellPath("/opt/homebrew/bin:/usr/bin"),
      readUserShell: () => process.execPath,
    });

    expect(env.PATH?.split(":")).toEqual(["/opt/homebrew/bin", "/usr/bin", "/bin"]);
  });

  test("merges the Linux login shell PATH before the inherited GUI PATH", async () => {
    const env = await resolveProcessEnvironment({
      baseEnv: { PATH: "/usr/bin:/bin" },
      platform: "linux",
      readLoginShellPath: loginShellPath("/home/dev/.local/bin:/usr/bin"),
      readUserShell: () => process.execPath,
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
      readUserShell: () => process.execPath,
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
    const env = await resolveProcessEnvironment({
      baseEnv: { SHELL: "/bin/bash", PATH: "/usr/bin:/bin" },
      platform: "darwin",
      readUserShell: () => shells.account,
      readLoginShellPath: loginShellPath("/usr/bin:/bin"),
    });

    expect(env.SHELL).toBe(shells.account);
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
      try {
        await writeFile(accountShellPath, "#!/bin/sh\n");
        await chmod(accountShellPath, 0o644);

        const env = await resolveProcessEnvironment({
          baseEnv: { SHELL: shells.configured, PATH: "/usr/bin:/bin" },
          platform: "linux",
          readUserShell: () => accountShellPath,
          readLoginShellPath: loginShellPath("/usr/bin:/bin"),
        });

        expect(env.SHELL).toBe(shells.configured);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  test("falls back to the inherited SHELL when the account shell is a nologin shell", async () => {
    const env = await resolveProcessEnvironment({
      baseEnv: { SHELL: shells.configured, PATH: "/usr/bin:/bin" },
      platform: "linux",
      readUserShell: () => shells.nologin,
      readLoginShellPath: loginShellPath("/usr/bin:/bin"),
    });

    expect(env.SHELL).toBe(shells.configured);
  });

  test("falls back to the inherited SHELL when the account shell does not exist", async () => {
    const env = await resolveProcessEnvironment({
      baseEnv: { SHELL: shells.configured, PATH: "/usr/bin:/bin" },
      platform: "linux",
      readUserShell: () => path.join(fixtureRoot, "missing-shell"),
      readLoginShellPath: loginShellPath("/usr/bin:/bin"),
    });

    expect(env.SHELL).toBe(shells.configured);
  });

  testIfPosixShellIsAvailable(
    "reads PATH from the account login shell before the SHELL value",
    async () => {
      const env = await resolveProcessEnvironment({
        baseEnv: { SHELL: shells.configured, PATH: "/usr/bin:/bin" },
        platform: "darwin",
        readUserShell: () => shells.account,
      });

      expect(env.PATH?.split(":")).toEqual(["/opt/account", "/usr/bin", "/bin"]);
    },
  );

  testIfPosixShellIsAvailable(
    "falls back to the SHELL value when the account shell is unavailable",
    async () => {
      const env = await resolveProcessEnvironment({
        baseEnv: { SHELL: shells.fallback, PATH: "/usr/bin:/bin" },
        platform: "darwin",
        readUserShell: () => null,
      });

      expect(env.PATH?.split(":")).toEqual(["/opt/bin", "/usr/bin", "/bin"]);
    },
  );

  testIfPosixShellIsAvailable(
    "matches the PATH from an interactive login fixture shell",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-interactive-login-shell-"));
      const shellPath = shells.interactiveTcsh;
      try {
        await writeFile(path.join(root, ".zshrc"), 'export PATH="/fixture/zshrc-only:$PATH"\n');
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

  testIfPosixShellIsAvailable("keeps an end marker literal in PATH", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "odt-login-shell-marker-"));
    try {
      const resolution = await Effect.runPromise(
        createProcessEnvironment({
          baseEnv: { HOME: root, PATH: "/inherited" },
          platform: "linux",
          readUserShell: () => shells.endMarker,
        }),
      );

      expect(resolution.error).toBeNull();
      expect(resolution.environment.PATH?.split(":")).toEqual([
        "/first",
        "/tmp/__OPENDUCKTOR_ENV_END__",
        "/inherited",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  testIfPosixShellIsAvailable(
    "keeps user shell variables and removes host control variables from the probe",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-login-shell-env-"));
      const configRoot = path.join(root, "zsh");
      try {
        await mkdir(configRoot);
        await writeFile(path.join(configRoot, ".zshrc"), 'export PATH="/fixture/zdotdir:$PATH"\n');

        const resolution = await Effect.runPromise(
          createProcessEnvironment({
            baseEnv: {
              HOME: root,
              ODT_HOST_TOKEN: "secret",
              PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
              USER: "fixture",
              ZDOTDIR: configRoot,
            },
            platform: "darwin",
            readUserShell: () => shells.zdotdir,
          }),
        );

        expect(resolution.error).toBeNull();
        expect(resolution.environment.PATH?.split(":")[0]).toBe("/fixture/zdotdir");
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
      const shellPath = shells.failing;
      try {
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
    "returns a typed diagnostic when the shell output has no PATH",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-invalid-login-shell-"));
      const shellPath = shells.noPath;
      try {
        const resolution = await Effect.runPromise(
          createProcessEnvironment({
            baseEnv: { HOME: root, PATH: "/gui/bin:/usr/bin" },
            platform: "linux",
            readUserShell: () => shellPath,
          }),
        );

        expect(resolution.error).toMatchObject({
          _tag: "ProcessEnvironmentError",
          reason: "invalid_output",
          shell: shellPath,
        });
        expect(resolution.environment.PATH).toBeUndefined();
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  testIfPosixShellIsAvailable(
    "reports invalid output when the shell exits cleanly without markers",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-markerless-login-shell-"));
      const shellPath = shells.markerless;
      try {
        const resolution = await Effect.runPromise(
          createProcessEnvironment({
            baseEnv: { HOME: root, PATH: "/gui/bin:/usr/bin" },
            loginShellTimeoutMs: 5_000,
            platform: "linux",
            readUserShell: () => shellPath,
          }).pipe(
            // Stay below the 5 s shell timeout, but allow for a slow process start under load.
            Effect.timeoutOrElse({
              duration: "3 seconds",
              orElse: () => Effect.fail(new Error("Marker-less shell exit did not finish.")),
            }),
          ),
        );

        expect(resolution.error).toMatchObject({
          _tag: "ProcessEnvironmentError",
          reason: "invalid_output",
          shell: shellPath,
        });
        expect(resolution.environment.PATH).toBeUndefined();
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  testIfPosixShellIsAvailable(
    "reports invalid output when a child keeps stdout open after the shell exits",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-markerless-child-shell-"));
      const shellPath = shells.markerlessChild;
      const childPidPath = path.join(root, "child.pid");
      let childPid: number | null = null;
      try {
        const resolution = await Effect.runPromise(
          createProcessEnvironment({
            baseEnv: { HOME: root, PATH: "/gui/bin:/usr/bin" },
            loginShellTimeoutMs: 5_000,
            platform: "linux",
            readUserShell: () => shellPath,
          }).pipe(
            // Stay below the 5 s shell timeout, but allow for a slow process start under load.
            Effect.timeoutOrElse({
              duration: "3 seconds",
              orElse: () => Effect.fail(new Error("Marker-less shell exit did not finish.")),
            }),
          ),
        );
        const stoppedPid = Number(await readFile(childPidPath, "utf8"));
        childPid = stoppedPid;

        expect(resolution.error).toMatchObject({
          _tag: "ProcessEnvironmentError",
          reason: "invalid_output",
          shell: shellPath,
        });
        expect(resolution.environment.PATH).toBeUndefined();
        await waitFor(() => processHasStopped(stoppedPid));
      } finally {
        stopChild(childPid);
        await rm(root, { force: true, recursive: true });
      }
    },
    // The shell may run for 3 s, and the test then waits for its child to stop.
    15_000,
  );

  testIfPosixShellIsAvailable(
    "returns a typed diagnostic when shell startup output is too large",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-large-login-shell-"));
      const shellPath = shells.largeOutput;
      try {
        const resolution = await Effect.runPromise(
          createProcessEnvironment({
            baseEnv: { HOME: root, PATH: "/gui/bin:/usr/bin" },
            platform: "linux",
            readUserShell: () => shellPath,
          }),
        );

        expect(resolution.error).toMatchObject({
          _tag: "ProcessEnvironmentError",
          reason: "output_limit",
          shell: shellPath,
        });
        expect(resolution.environment.PATH).toBeUndefined();
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  testIfPosixShellIsAvailable(
    "times out and stops child jobs",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-timeout-login-shell-"));
      const shellPath = shells.slow;
      const childPidPath = path.join(root, "child.pid");
      let childPid: number | null = null;
      try {
        const resolution = await Effect.runPromise(
          createProcessEnvironment({
            baseEnv: { HOME: root, PATH: "/gui/bin:/usr/bin" },
            // The fixture shell must start its child job before the timeout, also under load.
            loginShellTimeoutMs: 2_000,
            platform: "linux",
            readUserShell: () => shellPath,
          }),
        );
        const stoppedPid = Number(await readFile(childPidPath, "utf8"));
        childPid = stoppedPid;

        expect(resolution.error).toMatchObject({
          _tag: "ProcessEnvironmentError",
          reason: "timed_out",
          shell: shellPath,
        });
        expect(resolution.error?.message).toContain("wait for input");
        expect(resolution.environment.PATH).toBeUndefined();
        await waitFor(() => processHasStopped(stoppedPid));
      } finally {
        stopChild(childPid);
        await rm(root, { force: true, recursive: true });
      }
    },
    // The shell always runs out its 2 s timeout, and the test then waits for its child to stop.
    10_000,
  );

  testIfPosixShellIsAvailable(
    "finishes after the shell exits and stops a background child that inherited stdout",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-background-login-shell-"));
      const shellPath = shells.backgroundChild;
      const childPidPath = path.join(root, "child.pid");
      let childPid: number | null = null;
      try {
        const resolution = await Effect.runPromise(
          createProcessEnvironment({
            baseEnv: { HOME: root, PATH: "/gui/bin:/usr/bin" },
            // The fixture shell can need more than 1 s to start under a parallel suite.
            // The limit stays below the 5 s background child, so a probe that waits for
            // inherited stdout still times out.
            loginShellTimeoutMs: 3_000,
            platform: "linux",
            readUserShell: () => shellPath,
          }),
        );
        const stoppedPid = Number(await readFile(childPidPath, "utf8"));
        childPid = stoppedPid;

        expect(resolution.error).toBeNull();
        expect(resolution.environment.PATH?.split(":")[0]).toBe("/fixture/background");
        await waitFor(() => processHasStopped(stoppedPid));
      } finally {
        stopChild(childPid);
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
      ODT_RUNTIME_KIND: "claude",
      ODT_RUNTIME_SESSION_ID: "claude-session-1",
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
