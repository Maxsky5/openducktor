import { spawn } from "node:child_process";
import { Effect, Exit, Scope } from "effect";
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
    // Repo dev-server commands are configured as shell command strings so users can
    // keep common scripts such as `cd app && npm run dev` or inline env assignments.
    return {
      command: "/bin/sh",
      args: ["-lc", command],
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

  child.stdout?.on("data", (chunk: Buffer) => {
    onOutput({ data: chunk.toString("utf8") });
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    onOutput({ data: chunk.toString("utf8") });
  });
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
    let scope: Parameters<typeof Scope.close>[0] | null = null;
    return Effect.gen(function* () {
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

      const runtimeScope = yield* Scope.make();
      scope = runtimeScope;
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
      const stopProcess = Effect.gen(function* () {
        if (released) {
          return;
        }
        released = true;
        yield* terminateProcessTree({
          pid,
          label: `dev server command "${command}"`,
          isClosed: processTracker.isClosed,
          waitForExit: processTracker.waitForClose,
          stopTimeoutMs,
        }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "devServerProcess.stop")));
      });
      yield* Scope.addFinalizer(runtimeScope, stopProcess.pipe(Effect.ignore));

      const exitedDuringGracePeriod = yield* processTracker.waitForClose(startGracePeriodMs);
      const spawnError = processTracker.getSpawnError();
      if (spawnError) {
        return yield* Effect.fail(
          toHostOperationError(spawnError, "devServerProcess.spawn", launchFailureDetails),
        );
      }
      const immediateClose = processTracker.getCloseResult();
      if (exitedDuringGracePeriod && immediateClose) {
        return yield* Effect.fail(
          new DevServerProcessStartExitError(immediateClose.exitCode, immediateClose.signal),
        );
      }

      return {
        pid,
        stop() {
          return stopProcess.pipe(
            Effect.zipRight(Scope.close(runtimeScope, Exit.succeed(undefined)).pipe(Effect.ignore)),
            Effect.mapError((cause) => toHostOperationError(cause, "devServerProcess.stop")),
          );
        },
      };
    }).pipe(
      Effect.onError(() =>
        scope ? Scope.close(scope, Exit.fail("startup failed")).pipe(Effect.ignore) : Effect.void,
      ),
    );
  },
});
