import { isAbsolute } from "node:path";
import { Effect } from "effect";
import type { TerminalLaunchEnvironmentPort } from "../../application/terminals/terminal-launch-policy";
import { TerminalServiceError } from "../../application/terminals/terminal-service-error";
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

export const createTerminalLaunchEnvironment =
  ({
    readEnv,
    platform = process.platform,
    readUserShell = accountUserShell,
  }: TerminalLaunchEnvironmentInput): TerminalLaunchEnvironmentPort =>
  () =>
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
