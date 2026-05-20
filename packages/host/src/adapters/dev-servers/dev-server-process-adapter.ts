import { spawn } from "node:child_process";
import { Effect, Exit, Layer, Scope } from "effect";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  type DevServerProcessExit,
  type DevServerProcessPort,
  DevServerProcessPortTag,
  DevServerProcessStartExitError,
  type DevServerProcessStartInput,
} from "../../ports/dev-server-process-port";
import {
  createProcessCommandLaunch,
  parseProcessCommandLine,
} from "../process/process-command-launch";
import { shouldStartDetachedProcessGroup, terminateProcessTree } from "../process/process-tree";

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

type DevServerProcessTracker = {
  getCloseResult: () => DevServerProcessExit | null;
  getSpawnError: () => Error | null;
  isClosed: () => boolean;
  waitForClose: (timeoutMs: number) => Effect.Effect<boolean>;
};

const createLaunchFailureDetails = (
  command: string,
  cwd: string,
  launch: { command: string; args: string[] },
): DevServerLaunchFailureDetails => ({
  command,
  cwd,
  launchCommand: launch.command,
  launchArgs: launch.args,
});

const toDevServerSpawnError = (
  cause: unknown,
  details: DevServerLaunchFailureDetails,
): HostOperationError => toHostOperationError(cause, "devServerProcess.spawn", details);

const createInvalidPidError = (details: DevServerLaunchFailureDetails): HostOperationError =>
  new HostOperationError({
    message: "Failed to start dev server: child process did not expose a valid pid.",
    operation: "dev-server.start",
    details,
  });

const trackDevServerProcess = ({
  child,
  isStarted,
  onExit,
  onOutput,
  pid,
}: {
  child: DevServerChildProcess;
  isStarted: () => boolean;
  onExit: (exit: DevServerProcessExit) => void;
  onOutput: (output: { data: string }) => void;
  pid: number | undefined;
}): DevServerProcessTracker => {
  let closeResult: DevServerProcessExit | null = null;
  let spawnError: Error | null = null;
  const closeListeners = new Set<() => void>();

  const notifyCloseListeners = (): void => {
    for (const listener of closeListeners) {
      listener();
    }
  };
  const waitForClose = (timeoutMs: number): Effect.Effect<boolean> => {
    if (closeResult !== null || spawnError !== null) {
      return Effect.succeed(true);
    }

    return Effect.async<boolean>((resume, signal) => {
      let settled = false;
      const finish = (closed: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        closeListeners.delete(resolveTrue);
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        resume(Effect.succeed(closed));
      };
      const resolveTrue = () => finish(true);
      const abort = () => finish(false);
      const timeout = setTimeout(() => {
        finish(false);
      }, timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      closeListeners.add(resolveTrue);
    });
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    onOutput({ data: chunk.toString("utf8") });
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    onOutput({ data: chunk.toString("utf8") });
  });
  child.once("error", (error) => {
    spawnError = error;
    notifyCloseListeners();
    if (isStarted()) {
      onExit({
        pid: pid ?? -1,
        exitCode: null,
        signal: null,
        error: error.message,
      });
    }
  });
  child.once("close", (exitCode, signal) => {
    closeResult = {
      pid: pid ?? -1,
      exitCode,
      signal,
      error: null,
    };
    notifyCloseListeners();
    if (isStarted()) {
      onExit(closeResult);
    }
  });

  return {
    getCloseResult: () => closeResult,
    getSpawnError: () => spawnError,
    isClosed: () => closeResult !== null || spawnError !== null,
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
      if (command.trim().length === 0) {
        return yield* Effect.fail(
          new HostValidationError({
            message: "Dev server command is empty. Provide a command to run.",
            field: "command",
          }),
        );
      }
      const parsedCommand = yield* Effect.try({
        try: () => parseProcessCommandLine(command),
        catch: (cause) =>
          cause instanceof HostValidationError
            ? cause
            : toHostOperationError(cause, "devServerProcess.parseCommand", { command }),
      });
      const commandEnv = { ...processEnv, ...env };
      const launch = createProcessCommandLaunch(
        parsedCommand.command,
        parsedCommand.args,
        commandEnv,
        process.platform,
      );
      const launchFailureDetails = createLaunchFailureDetails(command, cwd, launch);

      const runtimeScope = yield* Scope.make();
      scope = runtimeScope;
      const child = yield* Effect.try({
        try: () =>
          spawn(launch.command, launch.args, {
            cwd,
            detached: shouldStartDetachedProcessGroup(process.platform),
            env: commandEnv,
            stdio: ["ignore", "pipe", "pipe"],
            windowsVerbatimArguments: launch.windowsVerbatimArguments === true,
          }),
        catch: (cause) => toDevServerSpawnError(cause, launchFailureDetails),
      });
      const pid = child.pid;
      let started = false;
      const processTracker = trackDevServerProcess({
        child,
        isStarted: () => started,
        onExit,
        onOutput,
        pid,
      });

      if (!pid || pid <= 0) {
        yield* processTracker.waitForClose(0);
        const spawnError = processTracker.getSpawnError();
        if (spawnError) {
          return yield* Effect.fail(toDevServerSpawnError(spawnError, launchFailureDetails));
        }
        return yield* Effect.fail(createInvalidPidError(launchFailureDetails));
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
        return yield* Effect.fail(toDevServerSpawnError(spawnError, launchFailureDetails));
      }
      const immediateClose = processTracker.getCloseResult();
      if (exitedDuringGracePeriod && immediateClose) {
        return yield* Effect.fail(
          new DevServerProcessStartExitError(immediateClose.exitCode, immediateClose.signal),
        );
      }

      started = true;

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

export const DevServerProcessPortLive = Layer.sync(DevServerProcessPortTag, () =>
  createDevServerProcessAdapter(),
);
