import { spawn } from "node:child_process";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../../infrastructure/process/process-command-launch";
import { resolveProcessCommandPath } from "../../infrastructure/process/process-command-resolution";
import { normalizeProcessEnvironment } from "../../infrastructure/process/process-environment";
import type {
  SystemCommandPort,
  SystemCommandResolveOptions,
  SystemCommandRunResult,
} from "../../ports/system-command-port";

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

export type CreateSystemCommandRunnerInput = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

const resolveCommandPath = (
  command: string,
  {
    env,
    searchPath,
  }: {
    env: NodeJS.ProcessEnv;
    searchPath?: readonly string[] | undefined;
  },
  platform: NodeJS.Platform,
) =>
  resolveProcessCommandPath(
    command,
    searchPath === undefined ? { env, platform } : { env, platform, searchPath },
  );

const firstNonEmptyLine = (value: string): string | null =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;

export const createSystemCommandRunner = ({
  env: inputEnv = process.env,
  platform = process.platform,
}: CreateSystemCommandRunnerInput = {}): SystemCommandPort => {
  const env = normalizeProcessEnvironment(inputEnv, platform);
  const runCommandAllowFailure: SystemCommandPort["runCommandAllowFailure"] = (
    command,
    args,
    options = {},
  ) =>
    Effect.gen(function* () {
      const commandEnv = normalizeProcessEnvironment({ ...env, ...options.env }, platform);
      const resolvedCommand = yield* resolveCommandPath(
        command,
        { env: commandEnv },
        platform,
      ).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "systemCommand.resolveCommandPath", {
            command,
            cwd: options.cwd,
          }),
        ),
      );
      if (resolvedCommand === null) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "systemCommand.resolveCommandPath",
            message: `Command ${command} not found.`,
            details: { command, cwd: options.cwd },
          }),
        );
      }
      const launch = yield* Effect.try({
        try: () => createProcessCommandLaunch(resolvedCommand, args, commandEnv, platform),
        catch: (cause) =>
          toHostOperationError(cause, "systemCommand.createProcessCommandLaunch", {
            command,
            args,
            cwd: options.cwd,
          }),
      });

      return yield* Effect.async<SystemCommandRunResult, HostOperationError>((resume, signal) => {
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(launch.command, launch.args, {
            cwd: options.cwd,
            env: launch.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsVerbatimArguments: launch.windowsVerbatimArguments,
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
    resolveCommandPath(command, options?: SystemCommandResolveOptions) {
      const commandEnv = normalizeProcessEnvironment(options?.env ?? env, platform);
      return resolveCommandPath(
        command,
        { env: commandEnv, searchPath: options?.searchPath },
        platform,
      );
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
