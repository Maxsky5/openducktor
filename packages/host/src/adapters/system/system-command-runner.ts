import { spawn } from "node:child_process";
import { Effect } from "effect";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../../infrastructure/process/process-command-launch";
import { resolveProcessCommandPath } from "../../infrastructure/process/process-command-resolution";
import {
  MACHINE_OUTPUT_ENV,
  normalizeProcessEnvironment,
} from "../../infrastructure/process/process-environment";
import { waitForChildProcessClose } from "../../infrastructure/process/process-tree";
import type {
  SystemCommandPort,
  SystemCommandResolveOptions,
  SystemCommandRunOptions,
  SystemCommandRunResult,
} from "../../ports/system-command-port";

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_STOP_TIMEOUT_MS = 500;

export type CreateSystemCommandRunnerInput = {
  /** Reads the environment when a command runs, so it uses the latest user PATH. */
  readEnv?: () => NodeJS.ProcessEnv;
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
  readEnv = () => process.env,
  platform = process.platform,
}: CreateSystemCommandRunnerInput = {}): SystemCommandPort => {
  const runCommandAllowFailure: SystemCommandPort["runCommandAllowFailure"] = (
    command,
    args,
    options = {},
  ) =>
    Effect.gen(function* () {
      const commandEnv = normalizeProcessEnvironment({ ...readEnv(), ...options.env }, platform);
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

      let cleanup: Effect.Effect<void, HostOperationErrorAggregate> = Effect.void;
      return yield* Effect.callback<SystemCommandRunResult, HostOperationErrorAggregate>(
        (resume) => {
          let child: ReturnType<typeof spawn>;
          try {
            child = spawn(launch.command, launch.args, {
              cwd: options.cwd,
              env: launch.env,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: launch.windowsHide,
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
          const stdoutChunks: Buffer[] = [];
          const stderrChunks: Buffer[] = [];
          let stdoutBytes = 0;
          let settled = false;
          let closed = false;
          const finish = (
            effect: Effect.Effect<SystemCommandRunResult, HostOperationErrorAggregate>,
          ) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resume(effect);
          };
          const timeout = setTimeout(() => {
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
          const onStdout = (chunk: Buffer) => {
            if (settled) return;
            stdoutBytes += chunk.length;
            if (options.maxStdoutBytes !== undefined && stdoutBytes > options.maxStdoutBytes) {
              finish(
                Effect.fail(
                  new HostOperationError({
                    operation: "systemCommand.runCommandAllowFailure",
                    message: `Command ${command} returned more than ${options.maxStdoutBytes} bytes.`,
                    details: { command, args, maxStdoutBytes: options.maxStdoutBytes },
                  }),
                ),
              );
              return;
            }
            stdoutChunks.push(chunk);
          };
          const onStderr = (chunk: Buffer) => {
            if (!settled) stderrChunks.push(chunk);
          };
          const onError = (error: Error) => {
            finish(
              Effect.fail(
                toHostOperationError(error, "systemCommand.runCommandAllowFailure", {
                  command,
                  args,
                  cwd: options.cwd,
                }),
              ),
            );
          };
          const onClose = (code: number | null) => {
            closed = true;
            if (settled) return;
            finish(
              Effect.succeed({
                ok: code === 0,
                exitCode: code,
                stdout: Buffer.concat(stdoutChunks).toString(options.stdoutEncoding ?? "utf8"),
                stderr: Buffer.concat(stderrChunks).toString("utf8"),
              }),
            );
          };
          child.stdout?.on("data", onStdout);
          child.stderr?.on("data", onStderr);
          child.on("error", onError);
          child.on("close", onClose);
          cleanup = Effect.gen(function* () {
            settled = true;
            clearTimeout(timeout);
            child.stdout?.off("data", onStdout);
            child.stderr?.off("data", onStderr);
            stdoutChunks.length = 0;
            stderrChunks.length = 0;
            // Drain without retaining output while waiting for process and pipe closure.
            child.stdout?.resume();
            child.stderr?.resume();
            if (closed) return;
            const signalErrors: unknown[] = [];
            const terminate = (signal: NodeJS.Signals) =>
              Effect.sync(() => {
                try {
                  if (!child.kill(signal) && child.exitCode === null && child.signalCode === null) {
                    signalErrors.push(`Could not send ${signal}.`);
                  }
                } catch (error) {
                  signalErrors.push(error);
                }
              });
            yield* terminate("SIGTERM");
            if (yield* waitForChildProcessClose(child, () => closed, COMMAND_STOP_TIMEOUT_MS))
              return;
            // Windows kill already forces termination; POSIX needs SIGKILL escalation.
            if (platform !== "win32") yield* terminate("SIGKILL");
            if (yield* waitForChildProcessClose(child, () => closed, COMMAND_STOP_TIMEOUT_MS))
              return;
            return yield* Effect.fail(
              new HostOperationError({
                operation: "systemCommand.runCommandAllowFailure.cleanup",
                message: `Failed to stop command ${command} and close its output within ${2 * COMMAND_STOP_TIMEOUT_MS}ms.`,
                details: { command, args, pid: child.pid, signalErrors },
              }),
            );
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                child.stdout?.destroy();
                child.stderr?.destroy();
                child.off("error", onError);
                child.off("close", onClose);
              }),
            ),
          );
          if (!child.stdout || !child.stderr) {
            finish(
              Effect.fail(
                new HostOperationError({
                  operation: "systemCommand.runCommandAllowFailure",
                  message: `Command ${command} did not expose piped stdout and stderr.`,
                  details: { command, args, cwd: options.cwd },
                }),
              ),
            );
          }
        },
      ).pipe(Effect.onExit(() => cleanup));
    });

  return {
    resolveCommandPath(command, options?: SystemCommandResolveOptions) {
      const commandEnv = normalizeProcessEnvironment(options?.env ?? readEnv(), platform);
      return resolveCommandPath(
        command,
        { env: commandEnv, searchPath: options?.searchPath },
        platform,
      );
    },
    versionCommand(command, args, options = {}) {
      // Version text goes to the UI. Disable terminal color even when the host environment forces
      // it, and keep the other environment values of the caller.
      const versionOptions: SystemCommandRunOptions = {
        ...options,
        env: {
          ...options.env,
          ...MACHINE_OUTPUT_ENV,
        },
      };
      return Effect.gen(function* () {
        const result = yield* runCommandAllowFailure(command, args, versionOptions).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        return result?.ok ? firstNonEmptyLine(result.stdout) : null;
      });
    },
    runCommandAllowFailure,
  };
};
