import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { TerminalCommandLines } from "../../application/terminals/terminal-command";
import { createTerminalLaunchEnvironment } from "./terminal-launch-environment";

const testIfPosixShellIsAvailable = process.platform === "win32" ? test.skip : test;

const resolveEnvironment = (input: Parameters<typeof createTerminalLaunchEnvironment>[0]) =>
  Effect.runPromise(createTerminalLaunchEnvironment(input).shell());

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
      }).shell(),
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
      }).shell(),
    ),
  );

  expect(failure.code).toBe("shell_unavailable");
});

testIfPosixShellIsAvailable(
  "runs command lines in the login shell with its own flags, and rejects an unknown shell",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-terminal-launch-environment-"));
    try {
      const launches = new Map<string, unknown>();
      for (const name of ["zsh", "tcsh", "fish", "nu"]) {
        const shellPath = join(root, name);
        await writeFile(shellPath, "#!/bin/sh\n");
        await chmod(shellPath, 0o755);
        const launch = await Effect.runPromise(
          Effect.result(
            createTerminalLaunchEnvironment({
              readEnv: () => ({ PATH: "/usr/bin" }),
              platform: "linux",
              readUserShell: () => shellPath,
            }).command(["bun install", "bun test"]),
          ),
        );
        launches.set(
          name,
          launch._tag === "Success"
            ? [launch.success.command.shell === shellPath, launch.success.command.args[0]]
            : { code: launch.failure.code, message: launch.failure.message },
        );
      }

      expect(Object.fromEntries(launches)).toEqual({
        zsh: [true, "-ilc"],
        tcsh: [true, "-ic"],
        fish: [true, "-ilc"],
        nu: {
          code: "unsupported_shell",
          message: `Commands cannot run in the login shell ${join(root, "nu")}. Use sh, bash, zsh, ksh, mksh, dash, ash, fish, csh, or tcsh as the login shell.`,
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);

const runWindowsCommand = (environment: NodeJS.ProcessEnv, commandLines: TerminalCommandLines) =>
  Effect.runPromise(
    Effect.result(
      createTerminalLaunchEnvironment({ readEnv: () => environment, platform: "win32" }).command(
        commandLines,
      ),
    ),
  );

test("runs command lines from a batch file that stops after the first failed line on Windows", async () => {
  const launch = await runWindowsCommand(
    { ComSpec: "/windows/system32/cmd.exe", Path: "/windows/system32" },
    ["cd app", 'echo "done" && exit /b 0'],
  );

  expect(launch._tag === "Success" && launch.success.command).toEqual({
    shell: "/windows/system32/cmd.exe",
    args: [],
    env: { ComSpec: "/windows/system32/cmd.exe", Path: "/windows/system32" },
    windowsBatchScript: [
      "@echo off",
      "cd app",
      "if %errorlevel% neq 0 exit /b %errorlevel%",
      'echo "done" && exit /b 0',
      "if %errorlevel% neq 0 exit /b %errorlevel%",
    ].join("\r\n"),
  });
});

test("rejects commands on Windows when ComSpec is not cmd.exe", async () => {
  const launch = await runWindowsCommand(
    { ComSpec: "/windows/system32/windows-powershell.exe", Path: "/windows/system32" },
    ["bun install"],
  );

  expect(launch._tag === "Failure" && launch.failure).toMatchObject({
    code: "unsupported_shell",
    message:
      "Commands cannot run in the shell /windows/system32/windows-powershell.exe. Set ComSpec to cmd.exe.",
  });
});

const runCommandLines = async (
  accountShell: string,
  home: string,
  commandLines: TerminalCommandLines,
) => {
  const environment = createTerminalLaunchEnvironment({
    readEnv: () => ({ PATH: "/usr/bin:/bin", HOME: home }),
    platform: "linux",
    readUserShell: () => accountShell,
  });
  const { shell, command: launch } = await Effect.runPromise(environment.command(commandLines));
  expect(launch.shell).toBe(accountShell);
  // The shell after the command is the same login shell.
  expect(shell).toMatchObject({ shell: accountShell, args: ["-l"], env: launch.env });
  const result = Bun.spawnSync([launch.shell, ...launch.args], {
    cwd: home,
    env: launch.env,
    stdin: "ignore",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
};

// Each shell runs its own syntax. State reaches later lines, and the run stops at the first failure.
const shellCases = [
  {
    shells: ["/bin/bash", "/bin/zsh", "/bin/sh"],
    lines: (target: string): TerminalCommandLines => [
      `cd "${target}"`,
      "cat marker.txt",
      "export ODT_COMMAND_VALUE=kept",
      'printf "VALUE=%s\\n" "$ODT_COMMAND_VALUE" # inline comment',
      'printf "SEMI\\n";',
      "false && true",
      'printf "NEVER\\n"',
    ],
    stdout: "in-target\nVALUE=kept\nSEMI\n",
    exitCode: 1,
  },
  {
    shells: ["/bin/tcsh", "/bin/csh"],
    lines: (target: string): TerminalCommandLines => [
      `cd "${target}"`,
      "cat marker.txt",
      "set odt_command_value = kept",
      'echo "VALUE=$odt_command_value"',
      'sh -c "exit 3"',
      "echo NEVER",
    ],
    stdout: "in-target\nVALUE=kept\n",
    exitCode: 3,
  },
  {
    shells: ["/usr/bin/fish", "/usr/local/bin/fish", "/opt/homebrew/bin/fish"],
    lines: (target: string): TerminalCommandLines => [
      `cd "${target}"`,
      "cat marker.txt",
      "set odt_command_value kept",
      'echo "VALUE=$odt_command_value"',
      'sh -c "exit 3"',
      "echo NEVER",
    ],
    stdout: "in-target\nVALUE=kept\n",
    exitCode: 3,
  },
];

testIfPosixShellIsAvailable(
  "keeps shell state and each line's meaning in each supported shell, and stops at the first failed line",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "odt-terminal-command-home-"));
    try {
      const target = await mkdtemp(join(home, "target-"));
      await writeFile(join(target, "marker.txt"), "in-target\n");
      for (const shellCase of shellCases) {
        for (const accountShell of shellCase.shells.filter((shell) => existsSync(shell))) {
          expect({
            accountShell,
            ...(await runCommandLines(accountShell, home, shellCase.lines(target))),
          }).toEqual({
            accountShell,
            exitCode: shellCase.exitCode,
            stdout: shellCase.stdout,
          });
        }
      }
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  },
);
