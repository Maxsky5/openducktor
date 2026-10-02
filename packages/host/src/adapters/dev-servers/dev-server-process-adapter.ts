import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { Cause, Effect } from "effect";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  createProcessCommandLaunch,
  type ProcessCommandLaunchPlan,
  parseProcessCommandLine,
} from "../../infrastructure/process/process-command-launch";
import { sanitizeChildProcessEnvironment } from "../../infrastructure/process/process-environment";
import {
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForObservedState,
} from "../../infrastructure/process/process-tree";
import {
  type DevServerProcessExit,
  type DevServerProcessPort,
  DevServerProcessStartExitError,
  type DevServerProcessStartInput,
} from "../../ports/dev-server-process-port";

export type CreateDevServerProcessAdapterInput = {
  processEnv?: NodeJS.ProcessEnv;
  startGracePeriodMs?: number;
  stopTimeoutMs?: number;
};

const DEFAULT_START_GRACE_PERIOD_MS = 150;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

type DevServerLaunchFailureDetails = {
  command: string;
  cwd: string;
  launchCommand: string;
  launchArgs: string[];
};

type DevServerChildProcess = ReturnType<typeof spawn>;

const createDevServerCommandLaunch = (
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): ProcessCommandLaunchPlan => {
  if (platform !== "win32") {
    // Commands can use shell syntax such as `cd app && npm run dev`.
    // A login shell could replace the host PATH through `/etc/profile`.
    // The app snapshot can differ from startup code that needs a real tty.
    return {
      command: "/bin/sh",
      args: ["-c", command],
      env,
      windowsHide: false,
      windowsVerbatimArguments: false,
    };
  }

  const parsedCommand = parseProcessCommandLine(command);
  return createProcessCommandLaunch(parsedCommand.command, parsedCommand.args, env, platform);
};

const trackDevServerProcess = ({
  child,
  onExit,
  onOutput,
  pid,
}: {
  child: DevServerChildProcess;
  onExit: (exit: DevServerProcessExit) => void;
  onOutput: (output: { data: string }) => void;
  pid: number | undefined;
}) => {
  let closeResult: DevServerProcessExit | null = null;
  let exitNotified = false;
  let spawnError: Error | null = null;
  const closeListeners = new Set<() => void>();

  const notifyExit = (exit: DevServerProcessExit): void => {
    if (exitNotified) {
      return;
    }
    exitNotified = true;
    onExit(exit);
  };

  const notifyCloseListeners = (): void => {
    for (const listener of closeListeners) {
      listener();
    }
  };
  const isClosed = (): boolean => closeResult !== null || spawnError !== null;
  const waitForClose = (timeoutMs: number): Effect.Effect<boolean> =>
    waitForObservedState({
      isComplete: isClosed,
      subscribe: (listener) => {
        closeListeners.add(listener);
        return () => closeListeners.delete(listener);
      },
      timeoutMs,
    });

  // Each pipe has its own UTF-8 stream. A code point can span native chunks.
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    const decoder = new StringDecoder("utf8");
    const publish = (data: string): void => {
      if (data.length > 0) onOutput({ data });
    };
    stream.on("data", (chunk: Buffer) => publish(decoder.write(chunk)));
    stream.once("end", () => publish(decoder.end()));
  }
  child.once("error", (error) => {
    spawnError = error;
    notifyCloseListeners();
    notifyExit({
      pid: pid ?? -1,
      exitCode: null,
      signal: null,
      error: error.message,
    });
  });
  child.once("close", (exitCode, signal) => {
    closeResult = {
      pid: pid ?? -1,
      exitCode,
      signal,
      error: null,
    };
    notifyCloseListeners();
    notifyExit(closeResult);
  });

  return {
    getCloseResult: () => closeResult,
    getSpawnError: () => spawnError,
    isClosed,
    waitForClose,
  };
};

export const createDevServerProcessAdapter = ({
  processEnv = process.env,
  startGracePeriodMs = DEFAULT_START_GRACE_PERIOD_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
}: CreateDevServerProcessAdapterInput = {}): DevServerProcessPort => ({
  start(input: DevServerProcessStartInput) {
    return Effect.uninterruptible(
      Effect.gen(function* () {
        const { command, cwd, env, onExit, onOutput } = input;
        const commandEnv = sanitizeChildProcessEnvironment(
          { ...processEnv, ...env },
          process.platform,
        );
        const launch = yield* Effect.try({
          try: () => createDevServerCommandLaunch(command, commandEnv, process.platform),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : toHostOperationError(cause, "devServerProcess.parseCommand", { command }),
        });
        const launchFailureDetails: DevServerLaunchFailureDetails = {
          command,
          cwd,
          launchCommand: launch.command,
          launchArgs: launch.args,
        };

        const child = yield* Effect.try({
          try: () =>
            spawn(launch.command, launch.args, {
              cwd,
              detached: shouldStartDetachedProcessGroup(process.platform),
              env: launch.env,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: launch.windowsHide,
              windowsVerbatimArguments: launch.windowsVerbatimArguments,
            }),
          catch: (cause) =>
            toHostOperationError(cause, "devServerProcess.spawn", launchFailureDetails),
        });
        const pid = child.pid;
        const processTracker = trackDevServerProcess({
          child,
          onExit,
          onOutput,
          pid,
        });

        if (!pid || pid <= 0) {
          yield* processTracker.waitForClose(0);
          const spawnError = processTracker.getSpawnError();
          if (spawnError) {
            return yield* Effect.fail(
              toHostOperationError(spawnError, "devServerProcess.spawn", launchFailureDetails),
            );
          }
          return yield* Effect.fail(
            new HostOperationError({
              message: "Failed to start dev server: child process did not expose a valid pid.",
              operation: "dev-server.start",
              details: launchFailureDetails,
            }),
          );
        }

        let released = false;
        let outputPaused = false;
        let stopping = false;
        const setOutputPaused = (paused: boolean) =>
          Effect.try({
            try: () => {
              outputPaused = paused;
              if (stopping || released) return;
              for (const stream of [child.stdout, child.stderr]) {
                if (paused) stream?.pause();
                else stream?.resume();
              }
            },
            catch: (cause) =>
              toHostOperationError(
                cause,
                paused ? "devServerProcess.pause" : "devServerProcess.resume",
              ),
          });
        const stopProcess = Effect.uninterruptibleMask((restore) =>
          restore(
            Effect.gen(function* () {
              if (released) {
                return;
              }
              stopping = true;
              yield* Effect.try({
                try: () => {
                  child.stdout?.resume();
                  child.stderr?.resume();
                },
                catch: (cause) => toHostOperationError(cause, "devServerProcess.resumeForStop"),
              });
              yield* terminateProcessTree({
                pid,
                label: `dev server command "${command}"`,
                isClosed: processTracker.isClosed,
                waitForExit: processTracker.waitForClose,
                stopTimeoutMs,
              }).pipe(
                Effect.mapError((cause) => toHostOperationError(cause, "devServerProcess.stop")),
              );
              released = true;
            }),
          ).pipe(
            Effect.catchAllCause((failure) =>
              Effect.gen(function* () {
                stopping = false;
                const restored = yield* Effect.either(setOutputPaused(outputPaused));
                return yield* Effect.failCause(
                  restored._tag === "Left"
                    ? Cause.sequential(failure, Cause.fail(restored.left))
                    : failure,
                );
              }),
            ),
          ),
        );

        return {
          pid,
          waitForReady: () =>
            Effect.gen(function* () {
              const exitedDuringGracePeriod =
                yield* processTracker.waitForClose(startGracePeriodMs);
              const spawnError = processTracker.getSpawnError();
              if (spawnError) {
                return yield* Effect.fail(
                  toHostOperationError(spawnError, "devServerProcess.spawn", launchFailureDetails),
                );
              }
              const immediateClose = processTracker.getCloseResult();
              if (exitedDuringGracePeriod && immediateClose) {
                return yield* Effect.fail(
                  new DevServerProcessStartExitError(
                    immediateClose.exitCode,
                    immediateClose.signal,
                  ),
                );
              }
            }),
          pauseOutput: () => setOutputPaused(true),
          resumeOutput: () => setOutputPaused(false),
          stop: () => stopProcess,
        };
      }),
    );
  },
});
