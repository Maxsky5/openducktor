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
    yield* ensureStartupContinuesEffect(shouldContinueStartup, "electron.main.initialize-host", {
      phase: "initialize-host",
    });
    yield* initializeHost(ready);
    yield* ensureStartupContinuesEffect(shouldContinueStartup, "electron.main.create-window", {
      phase: "create-window",
    });
    yield* createMainWindow(ready);
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
  startupEffect: Effect.Effect<unknown, ElectronError>;
};

export const runElectronMainStartupBoundary = async ({
  cleanupAfterFailure,
  exitProcess,
  logger,
  markShutdownComplete,
  markShutdownStarted,
  startupEffect,
}: StartupBoundaryOptions): Promise<void> => {
  const startupExit = await Effect.runPromiseExit(startupEffect);
  if (Exit.isSuccess(startupExit)) {
    return;
  }

  logger.error(
    "OpenDucktor Electron startup failed",
    causeToElectronBoundaryError(startupExit.cause),
  );
  markShutdownStarted();
  const cleanupExit = await Effect.runPromiseExit(cleanupAfterFailure());
  if (Exit.isFailure(cleanupExit)) {
    logger.error(
      "OpenDucktor host cleanup after startup failure failed",
      causeToElectronBoundaryError(cleanupExit.cause),
    );
  }
  markShutdownComplete();
  exitProcess(1);
};

export type ElectronMainShutdownOptions = {
  exitAfterShutdown?: boolean;
  reason: string;
};

type ShutdownControllerOptions = {
  disposeHost(reason: string): Effect.Effect<void, ElectronLifecycleError>;
  exitProcess(exitCode: number): void;
  logger: ElectronMainLifecycleLogger;
  quitApp(): void;
};

export type ElectronMainShutdownController = {
  isHostShutdownComplete(): boolean;
  isHostShutdownStarted(): boolean;
  markHostShutdownComplete(): void;
  markHostShutdownStarted(): void;
  shutdownHostAndQuit(options: ElectronMainShutdownOptions): Promise<void>;
};

export const createElectronMainShutdownController = ({
  disposeHost,
  exitProcess,
  logger,
  quitApp,
}: ShutdownControllerOptions): ElectronMainShutdownController => {
  let hostShutdownStarted = false;
  let hostShutdownComplete = false;

  const shutdownHostAndQuit = async ({
    exitAfterShutdown = false,
    reason,
  }: ElectronMainShutdownOptions): Promise<void> => {
    if (hostShutdownStarted) {
      return;
    }

    hostShutdownStarted = true;
    let exitCode = 0;
    logger.info(`OpenDucktor host shutdown started (${reason})`);
    const disposeExit = await Effect.runPromiseExit(disposeHost(reason));
    if (Exit.isFailure(disposeExit)) {
      exitCode = 1;
      logger.error(
        "OpenDucktor host shutdown failed",
        causeToElectronBoundaryError(disposeExit.cause),
      );
    } else {
      logger.info("OpenDucktor host shutdown complete");
    }

    hostShutdownComplete = true;
    if (exitAfterShutdown) {
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
    },
    markHostShutdownStarted: () => {
      hostShutdownStarted = true;
    },
    shutdownHostAndQuit,
  };
};
