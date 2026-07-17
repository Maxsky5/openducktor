import { Effect, Exit } from "effect";
import {
  causeToElectronBoundaryError,
  type ElectronError,
  type ElectronErrorDetails,
  ElectronLifecycleError,
} from "../effect/electron-errors";

type ElectronMainLifecycleLogger = {
  error(message: string, error?: unknown): void;
  info(message: string): void;
};

const captureLoggingFailure = async (
  operation: () => void | Promise<void>,
): Promise<unknown | undefined> => {
  try {
    await operation();
    return undefined;
  } catch (cause) {
    return cause;
  }
};

export type ElectronMainStartupSteps<PreReady, Ready> = {
  configureReady(preReady: PreReady): Effect.Effect<Ready, ElectronError>;
  createMainWindow(ready: Ready): Effect.Effect<void, ElectronError>;
  initializeHost(ready: Ready): Effect.Effect<void, ElectronError>;
  preparePreReady(): Effect.Effect<PreReady, ElectronError>;
  registerActivateHandler(ready: Ready): void;
  shouldContinueStartup?(): boolean;
  waitUntilReady(): Effect.Effect<void, ElectronError>;
};

const ensureStartupContinuesEffect = (
  shouldContinueStartup: (() => boolean) | undefined,
  operation: string,
  details?: ElectronErrorDetails,
): Effect.Effect<void, ElectronLifecycleError> => {
  if (!shouldContinueStartup || shouldContinueStartup()) {
    return Effect.void;
  }
  return Effect.fail(
    new ElectronLifecycleError({
      operation,
      message: "Electron startup stopped because host shutdown has started.",
      reason: "shutdown-started",
      details,
    }),
  );
};

export const composeElectronMainStartupEffect = <PreReady, Ready>({
  configureReady,
  createMainWindow,
  initializeHost,
  preparePreReady,
  registerActivateHandler,
  shouldContinueStartup,
  waitUntilReady,
}: ElectronMainStartupSteps<PreReady, Ready>): Effect.Effect<Ready, ElectronError> =>
  Effect.gen(function* () {
    const preReady = yield* preparePreReady();
    yield* ensureStartupContinuesEffect(shouldContinueStartup, "electron.main.before-ready-wait");
    yield* waitUntilReady();
    yield* ensureStartupContinuesEffect(shouldContinueStartup, "electron.main.configure-ready", {
      phase: "configure-ready",
    });
    const ready = yield* configureReady(preReady);
    yield* ensureStartupContinuesEffect(shouldContinueStartup, "electron.main.create-window", {
      phase: "create-window",
    });
    yield* createMainWindow(ready);
    yield* ensureStartupContinuesEffect(shouldContinueStartup, "electron.main.initialize-host", {
      phase: "initialize-host",
    });
    yield* initializeHost(ready);
    yield* ensureStartupContinuesEffect(shouldContinueStartup, "electron.main.register-activate", {
      phase: "register-activate",
    });
    yield* Effect.sync(() => {
      registerActivateHandler(ready);
    });
    return ready;
  });

type StartupBoundaryOptions = {
  cleanupAfterFailure(): Effect.Effect<void, ElectronLifecycleError>;
  exitProcess(exitCode: number): void;
  logger: ElectronMainLifecycleLogger;
  markShutdownComplete(): void;
  markShutdownStarted(): void;
  reportFailure(cause: unknown): void;
  startupEffect: Effect.Effect<unknown, ElectronError>;
};

export const runElectronMainStartupBoundary = async ({
  cleanupAfterFailure,
  exitProcess,
  logger,
  markShutdownComplete,
  markShutdownStarted,
  reportFailure,
  startupEffect,
}: StartupBoundaryOptions): Promise<void> => {
  const startupExit = await Effect.runPromiseExit(startupEffect);
  if (Exit.isSuccess(startupExit)) {
    return;
  }

  markShutdownStarted();
  let loggingFailure = await captureLoggingFailure(() =>
    logger.error(
      "OpenDucktor Electron startup failed",
      causeToElectronBoundaryError(startupExit.cause),
    ),
  );
  const cleanupExit = await Effect.runPromiseExit(cleanupAfterFailure());
  if (Exit.isFailure(cleanupExit) && loggingFailure === undefined) {
    loggingFailure = await captureLoggingFailure(() =>
      logger.error(
        "OpenDucktor host cleanup after startup failure failed",
        causeToElectronBoundaryError(cleanupExit.cause),
      ),
    );
  }
  markShutdownComplete();
  if (loggingFailure !== undefined) {
    reportFailure(loggingFailure);
  }
  exitProcess(1);
};

export type ElectronMainShutdownOptions = {
  exitAfterShutdown?: boolean;
  reason: string;
};

export type ElectronMainShutdownRunOptions = {
  reason: string;
  runAfterShutdown(): Promise<void>;
};

type ShutdownControllerOptions = {
  disposeHost(reason: string): Effect.Effect<void, ElectronLifecycleError>;
  exitProcess(exitCode: number): void;
  logger: ElectronMainLifecycleLogger;
  quitApp(): void;
  reportFailure(cause: unknown): void;
};

export type ElectronMainShutdownController = {
  isHostShutdownComplete(): boolean;
  isHostShutdownStarted(): boolean;
  markHostShutdownComplete(): void;
  markHostShutdownFailed(): void;
  markHostShutdownStarted(): void;
  shutdownHostAndQuit(options: ElectronMainShutdownOptions): Promise<void>;
  shutdownHostAndRun(options: ElectronMainShutdownRunOptions): Promise<void>;
};

export const createElectronMainShutdownController = ({
  disposeHost,
  exitProcess,
  logger,
  quitApp,
  reportFailure,
}: ShutdownControllerOptions): ElectronMainShutdownController => {
  let hostShutdownStarted = false;
  let hostShutdownComplete = false;
  let hostShutdownExitCode: number | null = null;

  const shutdownHost = async (
    reason: string,
    { rejectIfInProgress }: { rejectIfInProgress: boolean },
  ): Promise<number | null> => {
    if (hostShutdownStarted) {
      if (hostShutdownComplete) {
        return hostShutdownExitCode ?? 0;
      }
      if (!rejectIfInProgress) {
        return null;
      }
      throw new ElectronLifecycleError({
        operation: "electron.main.shutdown-host",
        message: "OpenDucktor host shutdown is already in progress.",
        reason,
      });
    }

    hostShutdownStarted = true;
    let exitCode = hostShutdownExitCode ?? 0;
    let loggingFailure = await captureLoggingFailure(() =>
      logger.info(`OpenDucktor host shutdown started (${reason})`),
    );
    const disposeExit = await Effect.runPromiseExit(disposeHost(reason));
    if (Exit.isFailure(disposeExit)) {
      exitCode = 1;
      if (loggingFailure === undefined) {
        loggingFailure = await captureLoggingFailure(() =>
          logger.error(
            "OpenDucktor host shutdown failed",
            causeToElectronBoundaryError(disposeExit.cause),
          ),
        );
      }
    } else if (loggingFailure === undefined) {
      loggingFailure = await captureLoggingFailure(() =>
        logger.info("OpenDucktor host shutdown complete"),
      );
    }
    if (loggingFailure !== undefined) {
      exitCode = 1;
      reportFailure(loggingFailure);
    }

    hostShutdownComplete = true;
    hostShutdownExitCode = Math.max(hostShutdownExitCode ?? 0, exitCode);
    return hostShutdownExitCode;
  };

  const shutdownHostAndQuit = async ({
    exitAfterShutdown = false,
    reason,
  }: ElectronMainShutdownOptions): Promise<void> => {
    const exitCode = await shutdownHost(reason, { rejectIfInProgress: false });
    if (exitCode === null) {
      return;
    }
    if (exitAfterShutdown || exitCode !== 0) {
      exitProcess(exitCode);
      return;
    }
    quitApp();
  };

  return {
    isHostShutdownComplete: () => hostShutdownComplete,
    isHostShutdownStarted: () => hostShutdownStarted,
    markHostShutdownComplete: () => {
      hostShutdownComplete = true;
      hostShutdownExitCode ??= 0;
    },
    markHostShutdownFailed: () => {
      hostShutdownExitCode = 1;
    },
    markHostShutdownStarted: () => {
      hostShutdownStarted = true;
    },
    shutdownHostAndQuit,
    shutdownHostAndRun: async ({ reason, runAfterShutdown }) => {
      const exitCode = await shutdownHost(reason, { rejectIfInProgress: true });
      if (exitCode !== 0) {
        throw new ElectronLifecycleError({
          operation: "electron.main.shutdown-host-before-run",
          message: "OpenDucktor host shutdown failed before the requested shutdown action.",
          reason,
        });
      }
      try {
        await runAfterShutdown();
      } catch (cause) {
        throw new ElectronLifecycleError({
          operation: "electron.main.run-after-shutdown",
          message: "The requested action failed after OpenDucktor host shutdown completed.",
          reason,
          cause,
        });
      }
    },
  };
};
