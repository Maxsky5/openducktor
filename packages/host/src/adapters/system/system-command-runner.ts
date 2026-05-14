import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { SystemCommandPort, SystemCommandRunResult } from "../../ports/system-command-port";

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

export type CreateSystemCommandRunnerInput = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

const commandFileNames = (
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] => {
  if (platform !== "win32") {
    return [command];
  }

  const extensionPattern = /\.[^\\/]+$/;
  if (extensionPattern.test(command)) {
    return [command];
  }

  const pathExt = env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
  return pathExt
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((extension) => `${command}${extension}`);
};

const canExecute = async (candidate: string): Promise<boolean> => {
  try {
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
  if (command.includes("/") || command.includes("\\")) {
    return (await canExecute(command)) ? command : null;
  }

  const pathValue = env.PATH ?? "";
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const fileName of commandFileNames(command, platform, env)) {
      const candidate = join(directory, fileName);
      if (await canExecute(candidate)) {
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

export const createSystemCommandRunner = ({
  env = process.env,
  platform = process.platform,
}: CreateSystemCommandRunnerInput = {}): SystemCommandPort => {
  const port: SystemCommandPort = {
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

    runCommandAllowFailure(command, args, options = {}) {
      return new Promise<SystemCommandRunResult>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: options.cwd,
          env: { ...env, ...options.env },
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
