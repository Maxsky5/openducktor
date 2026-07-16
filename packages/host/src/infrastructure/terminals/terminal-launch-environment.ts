import { userInfo } from "node:os";
import { isAbsolute } from "node:path";
import { Effect } from "effect";
import type { TerminalLaunchEnvironmentPort } from "../../application/terminals/terminal-launch-policy";
import { TerminalServiceError } from "../../application/terminals/terminal-service-error";
import { sanitizeChildProcessEnvironment } from "../process/process-environment";

type TerminalLaunchEnvironmentInput = {
  processEnv: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readUserShell?: () => string | null;
};

const accountShell = (): string | null => {
  try {
    return userInfo().shell || null;
  } catch {
    return null;
  }
};

export const createTerminalLaunchEnvironment =
  ({
    processEnv,
    platform = process.platform,
    readUserShell = accountShell,
  }: TerminalLaunchEnvironmentInput): TerminalLaunchEnvironmentPort =>
  () =>
    Effect.gen(function* () {
      const environment = sanitizeChildProcessEnvironment(processEnv, platform);
      const configuredShell =
        platform === "win32" ? (environment.ComSpec ?? environment.COMSPEC) : environment.SHELL;
      const shell =
        configuredShell && isAbsolute(configuredShell) ? configuredShell : readUserShell();
      if (!shell || !isAbsolute(shell)) {
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
        env.TERM = "xterm-256color";
        env.COLORTERM = "truecolor";
      }
      return { shell, args: platform === "win32" ? [] : ["-l"], env };
    });
