import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { SystemCommandPort, SystemCommandRunResult } from "../../ports/system-command-port";

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const WINDOWS_DEFAULT_PATHEXT = [".EXE", ".CMD", ".BAT", ".COM"];

export type CreateSystemCommandRunnerInput = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

const pathDelimiterForPlatform = (platform: NodeJS.Platform): string =>
  platform === "win32" ? ";" : ":";

const commandHasPath = (command: string): boolean =>
  command.includes("/") || command.includes("\\");

const hasCommandExtension = (command: string): boolean => extname(command).length > 0;

const windowsPathExt = (env: NodeJS.ProcessEnv): string[] => {
  const configured = env.PATHEXT;
  if (configured === undefined) {
    return WINDOWS_DEFAULT_PATHEXT;
  }

  const extensions = configured
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));

  return extensions.length > 0 ? extensions : WINDOWS_DEFAULT_PATHEXT;
};

const commandFileNames = (
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] => {
  if (platform !== "win32" || hasCommandExtension(command) || commandHasPath(command)) {
    return [command];
  }

  return windowsPathExt(env).map((extension) => `${command}${extension}`);
};

const canExecute = async (candidate: string, platform: NodeJS.Platform): Promise<boolean> => {
  try {
    if (platform === "win32") {
      return (await stat(candidate)).isFile();
    }

    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveCommandPath = async (
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | null> => {
  if (commandHasPath(command)) {
    return (await canExecute(command, platform)) ? command : null;
  }

  const pathValue = env.PATH ?? "";
  for (const directory of pathValue.split(pathDelimiterForPlatform(platform)).filter(Boolean)) {
    for (const fileName of commandFileNames(command, platform, env)) {
      const candidate = join(directory, fileName);
      if (await canExecute(candidate, platform)) {
        return candidate;
      }
    }
  }

  return null;
};

const firstNonEmptyLine = (value: string): string | null =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;

const quoteWindowsCommandArgument = (value: string): string => {
  if (value.length === 0) {
    return `""`;
  }
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll(`"`, `\\"`)}"`;
};

export const createSystemCommandLaunch = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): { command: string; args: string[] } => {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/iu.test(command)) {
    return { command, args };
  }

  const shell = env.ComSpec?.trim() || process.env.ComSpec || "cmd.exe";
  const commandLine = `"${[command, ...args].map(quoteWindowsCommandArgument).join(" ")}"`;
  return {
    command: shell,
    args: ["/d", "/s", "/c", commandLine],
  };
};

export const createSystemCommandRunner = ({
  env = process.env,
  platform = process.platform,
}: CreateSystemCommandRunnerInput = {}): SystemCommandPort => {
  const port: SystemCommandPort = {
    resolveCommandPath(command, commandEnv = env) {
      return resolveCommandPath(command, commandEnv, platform);
    },

    async requiredCommandError(command) {
      const resolved = await resolveCommandPath(command, env, platform);
      return resolved === null
        ? `Required command \`${command}\` not found. Install ${command} and ensure it is available on PATH.`
        : null;
    },

    async versionCommand(command, args, options) {
      try {
        const result = await port.runCommandAllowFailure(command, args, options);
        return result.ok ? firstNonEmptyLine(result.stdout) : null;
      } catch {
        return null;
      }
    },

    async runCommandAllowFailure(command, args, options = {}) {
      const commandEnv = { ...env, ...options.env };
      const resolvedCommand = (await resolveCommandPath(command, commandEnv, platform)) ?? command;
      const launch = createSystemCommandLaunch(resolvedCommand, args, commandEnv, platform);
      return new Promise<SystemCommandRunResult>((resolve, reject) => {
        const child = spawn(launch.command, launch.args, {
          cwd: options.cwd,
          env: commandEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill("SIGTERM");
          reject(
            new Error(
              `Timed out running ${command} after ${options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS}ms`,
            ),
          );
        }, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);

        child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
        child.on("error", (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
        child.on("close", (code) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve({
            ok: code === 0,
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
          });
        });
      });
    },
  };

  return port;
};
