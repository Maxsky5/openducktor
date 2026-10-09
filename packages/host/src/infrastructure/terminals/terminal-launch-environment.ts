import { basename, isAbsolute } from "node:path";
import { Effect } from "effect";
import type { TerminalCommandLines } from "../../application/terminals/terminal-command";
import type {
  TerminalCommandLaunch,
  TerminalLaunchEnvironmentPort,
  TerminalShellLaunch,
} from "../../application/terminals/terminal-launch-policy";
import { TerminalServiceError } from "../../application/terminals/terminal-service-error";
import { isCshShell, loginCommandFlag } from "../process/login-shell-flags";
import {
  accountUserShell,
  type ReadUserShell,
  resolveUserLoginShell,
  sanitizeChildProcessEnvironment,
} from "../process/process-environment";

type TerminalLaunchEnvironmentInput = {
  readEnv: () => NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readUserShell?: ReadUserShell;
};

export const createTerminalLaunchEnvironment = ({
  readEnv,
  platform = process.platform,
  readUserShell = accountUserShell,
}: TerminalLaunchEnvironmentInput): TerminalLaunchEnvironmentPort => {
  const resolveShell = (): Effect.Effect<TerminalShellLaunch, TerminalServiceError> =>
    Effect.gen(function* () {
      const environment = sanitizeChildProcessEnvironment(readEnv(), platform);
      const shell = resolveTerminalShell({ environment, platform, readUserShell });
      if (!shell) {
        return yield* new TerminalServiceError({
          code: "shell_unavailable",
          operation: "create",
          message: "The current user shell is unavailable or is not an absolute path.",
        });
      }
      const env: Record<string, string> = {};
      for (const [name, value] of Object.entries(environment)) {
        if (value !== undefined) {
          env[name] = value;
        }
      }
      if (platform !== "win32") {
        env.SHELL = shell;
        env.TERM = "xterm-256color";
        env.COLORTERM = "truecolor";
      }
      return { shell, args: platform === "win32" ? [] : ["-l"], env };
    });
  return {
    shell: resolveShell,
    command: (commandLines) =>
      resolveShell().pipe(
        Effect.flatMap((shell) =>
          commandLaunch(shell, platform, commandLines).pipe(
            Effect.map((command) => ({ shell, command })),
          ),
        ),
      ),
  };
};

const resolveTerminalShell = ({
  environment,
  platform,
  readUserShell,
}: {
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  readUserShell: ReadUserShell;
}): string | null => {
  if (platform === "win32") {
    const configuredShell = environment.ComSpec ?? environment.COMSPEC;
    if (configuredShell && isAbsolute(configuredShell)) {
      return configuredShell;
    }
    const accountShell = readUserShell();
    return accountShell && isAbsolute(accountShell) ? accountShell : null;
  }

  return resolveUserLoginShell(environment, readUserShell);
};

const commandLaunch = (
  { shell, env }: TerminalShellLaunch,
  platform: NodeJS.Platform,
  commandLines: TerminalCommandLines,
): Effect.Effect<TerminalCommandLaunch, TerminalServiceError> => {
  const shellName = basename(shell).toLowerCase();
  if (platform === "win32" && shellName === "cmd.exe") {
    return Effect.succeed({
      shell,
      args: [],
      env,
      windowsBatchScript: windowsCommandBatch(commandLines),
    });
  }
  const script = platform === "win32" ? null : commandScript(shellName, commandLines);
  if (script !== null) {
    return Effect.succeed({ shell, env, args: [loginCommandFlag(shellName), script] });
  }
  return Effect.fail(
    new TerminalServiceError({
      code: "unsupported_shell",
      operation: "start_command",
      message:
        platform === "win32"
          ? `Commands cannot run in the shell ${shell}. Set ComSpec to cmd.exe.`
          : `Commands cannot run in the login shell ${shell}. Use sh, bash, zsh, ksh, mksh, dash, ash, fish, csh, or tcsh as the login shell.`,
    }),
  );
};

// Each script runs all lines in one shell process, so directory and variable changes reach later
// lines. Each line stays unchanged, so its comments and terminators keep their meaning. The script
// stops after the first failed line and exits with that line's status.

const POSIX_SHELL_NAMES = new Set(["sh", "bash", "zsh", "ksh", "mksh", "dash", "ash"]);

const commandScript = (shellName: string, commandLines: TerminalCommandLines): string | null => {
  if (POSIX_SHELL_NAMES.has(shellName)) return posixCommandScript(commandLines);
  if (isCshShell(shellName)) return blockCommandScript(CSH_SYNTAX, commandLines);
  if (shellName === "fish") return blockCommandScript(FISH_SYNTAX, commandLines);
  return null;
};

const posixCommandScript = (commandLines: TerminalCommandLines): string =>
  commandLines
    .map(
      (line) =>
        `${line}\n__odt_status=$?; if [ "$__odt_status" -ne 0 ]; then exit "$__odt_status"; fi`,
    )
    .join("\n");

type BlockSyntax = { ifSuccess: string; saveStatus: string; endIf: string };

// csh applies `exit` only at the end of a `-c` script, and `endif` resets `$status`. Nested blocks
// skip the later lines, and the last command returns the saved status.
const CSH_SYNTAX: BlockSyntax = {
  ifSuccess: "if ($__odt_status == 0) then",
  saveStatus: "set __odt_status = $status",
  endIf: "endif",
};

const FISH_SYNTAX: BlockSyntax = {
  ifSuccess: "if test $__odt_status -eq 0",
  saveStatus: "set __odt_status $status",
  endIf: "end",
};

const blockCommandScript = (syntax: BlockSyntax, commandLines: TerminalCommandLines): string =>
  [
    ...commandLines.flatMap((line, index) => [
      ...(index === 0 ? [] : [syntax.ifSuccess]),
      line,
      syntax.saveStatus,
    ]),
    ...commandLines.slice(1).map(() => syntax.endIf),
    "exit $__odt_status",
  ].join("\n");

// cmd reads each batch line when it runs it, so `%errorlevel%` holds the status of the line above.
const windowsCommandBatch = (commandLines: TerminalCommandLines): string =>
  [
    "@echo off",
    ...commandLines.flatMap((line) => [line, "if %errorlevel% neq 0 exit /b %errorlevel%"]),
  ].join("\r\n");
