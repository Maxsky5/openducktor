import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Effect, Layer } from "effect";
import {
  HostOperationError,
  toHostOperationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import {
  type SystemCommandPort,
  SystemCommandPortTag,
  type SystemCommandRunResult,
} from "../../ports/system-command-port";

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

const canExecute = (candidate: string, platform: NodeJS.Platform) =>
  Effect.gen(function* () {
    if (platform === "win32") {
      const file = yield* Effect.tryPromise({
        try: () => stat(candidate),
        catch: (cause) => toHostPathStatError(cause, "systemCommand.canExecute", candidate),
      });
      return file.isFile();
    }

    yield* Effect.tryPromise({
      try: () => access(candidate, constants.X_OK),
      catch: (cause) => toHostPathStatError(cause, "systemCommand.canExecute", candidate),
    });
    return true;
  }).pipe(
    Effect.catchTags({
      HostPathAccessError: () => Effect.succeed(false),
      HostPathNotFoundError: () => Effect.succeed(false),
    }),
  );

const resolveCommandPath = (command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) =>
  Effect.gen(function* () {
    if (commandHasPath(command)) {
      return (yield* canExecute(command, platform)) ? command : null;
    }

    const pathValue = env.PATH ?? "";
    for (const directory of pathValue.split(pathDelimiterForPlatform(platform)).filter(Boolean)) {
      for (const fileName of commandFileNames(command, platform, env)) {
        const candidate = join(directory, fileName);
        if (yield* canExecute(candidate, platform)) {
          return candidate;
        }
      }
    }

    return null;
  });

const firstNonEmptyLine = (value: string): string | null =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;

const quoteWindowsCommandArgument = (value: string): string => {
  if (value.length === 0) {
    return `""`;
  }
  if (!/[\s"%^]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll("^", "^^").replaceAll("%", "%%").replaceAll(`"`, `^"`)}"`;
};

const isWindowsCommandScript = (command: string, platform: NodeJS.Platform): boolean =>
  platform === "win32" && /\.(?:cmd|bat)$/iu.test(command);

export const createSystemCommandLaunch = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } => {
  if (!isWindowsCommandScript(command, platform)) {
    return { command, args };
  }

  const windowsCommandShell = env.ComSpec?.trim() || process.env.ComSpec || "cmd.exe";
  const shellOptions = ["/d", "/s", "/c"];
  const quotedScriptInvocation = [command, ...args].map(quoteWindowsCommandArgument).join(" ");
  const shellCommandLine = `"${quotedScriptInvocation}"`;

  return {
    command: windowsCommandShell,
    args: [...shellOptions, shellCommandLine],
    windowsVerbatimArguments: true,
  };
};

export const createSystemCommandRunner = ({
  env = process.env,
  platform = process.platform,
}: CreateSystemCommandRunnerInput = {}): SystemCommandPort => {
  const runCommandAllowFailure: SystemCommandPort["runCommandAllowFailure"] = (
    command,
    args,
    options = {},
  ) =>
    Effect.gen(function* () {
      const commandEnv = { ...env, ...options.env };
      const resolvedCommand = yield* resolveCommandPath(command, commandEnv, platform).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "systemCommand.resolveCommandPath", {
            command,
            cwd: options.cwd,
          }),
        ),
      );
      const launch = createSystemCommandLaunch(
        resolvedCommand ?? command,
        args,
        commandEnv,
        platform,
      );

      return yield* Effect.async<SystemCommandRunResult, HostOperationError>((resume, signal) => {
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(launch.command, launch.args, {
            cwd: options.cwd,
            env: commandEnv,
            stdio: ["ignore", "pipe", "pipe"],
            windowsVerbatimArguments: launch.windowsVerbatimArguments === true,
          });
        } catch (error) {
          resume(
            Effect.fail(
              toHostOperationError(error, "systemCommand.runCommandAllowFailure.spawn", {
                command,
                args,
                cwd: options.cwd,
              }),
            ),
          );
          return;
        }
        if (!child.stdout || !child.stderr) {
          child.kill("SIGTERM");
          resume(
            Effect.fail(
              new HostOperationError({
                operation: "systemCommand.runCommandAllowFailure",
                message: `Command ${command} did not expose piped stdout and stderr.`,
                details: { command, args, cwd: options.cwd },
              }),
            ),
          );
          return;
        }
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let settled = false;
        const finish = (effect: Effect.Effect<SystemCommandRunResult, HostOperationError>) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          signal.removeEventListener("abort", abort);
          resume(effect);
        };
        const timeout = setTimeout(() => {
          child.kill("SIGTERM");
          finish(
            Effect.fail(
              new HostOperationError({
                operation: "systemCommand.runCommandAllowFailure",
                message: `Timed out running ${command} after ${options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS}ms`,
                details: {
                  command,
                  args,
                  timeoutMs: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
                },
              }),
            ),
          );
        }, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
        const abort = () => {
          child.kill("SIGTERM");
          finish(
            Effect.fail(
              new HostOperationError({
                operation: "systemCommand.runCommandAllowFailure",
                message: `Command ${command} was aborted.`,
                details: { command, args },
              }),
            ),
          );
        };
        signal.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
        child.on("error", (error) => {
          finish(
            Effect.fail(
              toHostOperationError(error, "systemCommand.runCommandAllowFailure", {
                command,
                args,
                cwd: options.cwd,
              }),
            ),
          );
        });
        child.on("close", (code) => {
          finish(
            Effect.succeed({
              ok: code === 0,
              stdout: Buffer.concat(stdoutChunks).toString("utf8"),
              stderr: Buffer.concat(stderrChunks).toString("utf8"),
            }),
          );
        });
      });
    });

  return {
    resolveCommandPath(command, commandEnv = env) {
      return resolveCommandPath(command, commandEnv, platform);
    },
    requiredCommandError(command) {
      return Effect.gen(function* () {
        const resolved = yield* resolveCommandPath(command, env, platform);
        return resolved === null
          ? `Required command \`${command}\` not found. Install ${command} and ensure it is available on PATH.`
          : null;
      });
    },
    versionCommand(command, args, options) {
      return Effect.gen(function* () {
        const result = yield* runCommandAllowFailure(command, args, options).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );
        return result?.ok ? firstNonEmptyLine(result.stdout) : null;
      });
    },
    runCommandAllowFailure,
  };
};

export const SystemCommandPortLive = Layer.succeed(
  SystemCommandPortTag,
  createSystemCommandRunner(),
);
