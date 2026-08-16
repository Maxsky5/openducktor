import { Deferred, Effect } from "effect";
import {
  causeToWebBoundaryError,
  combineWebErrors,
  runWebBoundary,
  type WebError,
} from "./effect/web-errors";
import type { FrontendServer } from "./launcher-support";
import { type WebLogger, writeWebLogEffect } from "./logger";
import type { TypescriptHostBackend } from "./typescript-host-backend";

const DUPLICATE_TERMINATION_NOTICE =
  "OpenDucktor web shutdown is already in progress; waiting for cleanup to finish.";

export const logDuplicateWebTerminationNotice = (
  logger: WebLogger,
  reportFailure: (cause: unknown) => void,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const result = yield* Effect.either(
      writeWebLogEffect(logger, "info", DUPLICATE_TERMINATION_NOTICE),
    );
    if (result._tag === "Right") {
      return false;
    }
    yield* Effect.sync(() => reportFailure(result.left));
    return true;
  });

export type WebSignalShutdownRequest = {
  awaitDuplicateTerminationLog: () => Promise<boolean>;
  closeDuplicateTerminationLogAdmission: () => void;
  exitCode: number;
  logger: WebLogger;
  signal: NodeJS.Signals;
  stop: Effect.Effect<void, WebError>;
};

type StopResourcesInput = {
  closeFrontend(server: FrontendServer | null): Effect.Effect<void, WebError>;
  frontendServer: FrontendServer | null;
  hostBackend: TypescriptHostBackend | null;
};

type WebLauncherLifecycleOptions = {
  closeFrontend(server: FrontendServer): Effect.Effect<void, WebError>;
  logger: WebLogger;
  onSignalShutdownFailure(cause: unknown): void;
  reportFailure(cause: unknown): void;
  runSignalShutdown(request: WebSignalShutdownRequest): Promise<void>;
  stopResources(input: StopResourcesInput): Effect.Effect<void, WebError>;
};

type StopState =
  | { readonly _tag: "running" }
  | { readonly _tag: "stopping" }
  | {
      readonly _tag: "released";
      readonly failureReported: boolean;
    };

type FrontendState =
  | { readonly _tag: "absent" }
  | { readonly _tag: "open"; readonly server: FrontendServer }
  | { readonly _tag: "closed" };

type HostState =
  | { readonly _tag: "absent" }
  | { readonly _tag: "open"; readonly backend: TypescriptHostBackend }
  | { readonly _tag: "closed" };

type TerminationState =
  | { readonly _tag: "idle" }
  | {
      readonly _tag: "active";
      admission: "closed" | "open";
      duplicateLog: Promise<boolean> | null;
      shutdown: Promise<void>;
    };

export type WebLauncherLifecycle = {
  completeAfterHostExit(): Effect.Effect<void, WebError>;
  handleTermination(signal: NodeJS.Signals, exitCode: number): Promise<void>;
  registerFrontend(server: FrontendServer): Effect.Effect<void, WebError>;
  registerHost(backend: TypescriptHostBackend): Effect.Effect<void, WebError>;
  release(): Effect.Effect<void>;
  stop(): Effect.Effect<void, WebError>;
};

export const createWebLauncherLifecycle = (
  options: WebLauncherLifecycleOptions,
): Effect.Effect<WebLauncherLifecycle> =>
  Effect.gen(function* () {
    const stopResult = yield* Deferred.make<void, WebError>();
    let stopState: StopState = { _tag: "running" };
    let frontendState: FrontendState = { _tag: "absent" };
    let hostState: HostState = { _tag: "absent" };
    let terminationState: TerminationState = { _tag: "idle" };

    const closeFrontendOnce = (): Effect.Effect<void, WebError> =>
      Effect.suspend(() => {
        if (frontendState._tag !== "open") {
          return Effect.void;
        }
        const { server } = frontendState;
        frontendState = { _tag: "closed" };
        return options.closeFrontend(server);
      });

    const settleStop = (effect: Effect.Effect<void, WebError>): Effect.Effect<void, WebError> =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const exit = yield* Effect.exit(effect);
          stopState = { _tag: "released", failureReported: false };
          yield* Deferred.done(stopResult, exit);
          return yield* Deferred.await(stopResult);
        }),
      );

    const stopResourcesWithLogs = (): Effect.Effect<void, WebError> =>
      Effect.gen(function* () {
        const failures: WebError[] = [];
        for (const message of [
          "Stopping OpenDucktor frontend server...",
          "Stopping OpenDucktor TypeScript host services...",
        ]) {
          const logExit = yield* Effect.exit(writeWebLogEffect(options.logger, "info", message));
          if (logExit._tag === "Failure") {
            failures.push(causeToWebBoundaryError(logExit.cause));
          }
        }

        const frontendServer = frontendState._tag === "open" ? frontendState.server : null;
        const hostBackend = hostState._tag === "open" ? hostState.backend : null;
        hostState = { _tag: "closed" };
        const stopExit = yield* Effect.exit(
          options.stopResources({
            closeFrontend: () => closeFrontendOnce(),
            frontendServer,
            hostBackend,
          }),
        );
        if (stopExit._tag === "Failure") {
          failures.push(causeToWebBoundaryError(stopExit.cause));
        }
        if (failures.length === 0) {
          const successExit = yield* Effect.exit(
            writeWebLogEffect(options.logger, "success", "OpenDucktor web stopped."),
          );
          if (successExit._tag === "Failure") {
            failures.push(causeToWebBoundaryError(successExit.cause));
          }
        }

        const failure = combineWebErrors(
          "web.launcher.lifecycle",
          "OpenDucktor web lifecycle failed.",
          failures,
        );
        if (failure) {
          return yield* failure;
        }
      });

    const stop = (): Effect.Effect<void, WebError> =>
      Effect.suspend(() => {
        if (stopState._tag !== "running") {
          return Deferred.await(stopResult);
        }
        stopState = { _tag: "stopping" };
        return settleStop(stopResourcesWithLogs());
      });

    const completeAfterHostExit = (): Effect.Effect<void, WebError> =>
      Effect.suspend(() => {
        hostState = { _tag: "closed" };
        if (stopState._tag !== "running") {
          const activeShutdown =
            terminationState._tag === "active" ? terminationState.shutdown : null;
          return Deferred.await(stopResult).pipe(
            Effect.zipRight(activeShutdown ? Effect.promise(() => activeShutdown) : Effect.void),
          );
        }
        stopState = { _tag: "stopping" };
        return settleStop(
          Effect.gen(function* () {
            const failures: WebError[] = [];
            const logExit = yield* Effect.exit(
              writeWebLogEffect(
                options.logger,
                "info",
                "OpenDucktor TypeScript host exited; stopping frontend server...",
              ),
            );
            if (logExit._tag === "Failure") {
              failures.push(causeToWebBoundaryError(logExit.cause));
            }
            const closeExit = yield* Effect.exit(closeFrontendOnce());
            if (closeExit._tag === "Failure") {
              failures.push(causeToWebBoundaryError(closeExit.cause));
            }
            if (failures.length === 0) {
              yield* writeWebLogEffect(options.logger, "success", "OpenDucktor web stopped.");
            }
            const failure = combineWebErrors(
              "web.launcher.lifecycle",
              "OpenDucktor web lifecycle failed.",
              failures,
            );
            if (failure) {
              return yield* failure;
            }
          }),
        );
      });

    const closeDuplicateTerminationLogAdmission = (): void => {
      if (terminationState._tag === "active") {
        terminationState.admission = "closed";
      }
    };

    const awaitDuplicateTerminationLog = async (): Promise<boolean> => {
      if (terminationState._tag !== "active" || terminationState.duplicateLog === null) {
        return false;
      }
      return terminationState.duplicateLog;
    };

    const startTermination = (signal: NodeJS.Signals, exitCode: number): Promise<void> => {
      if (terminationState._tag !== "idle") {
        return terminationState.shutdown;
      }
      terminationState = {
        _tag: "active",
        admission: "open",
        duplicateLog: null,
        shutdown: Promise.resolve(),
      };
      const shutdown = options
        .runSignalShutdown({
          awaitDuplicateTerminationLog,
          closeDuplicateTerminationLogAdmission,
          exitCode,
          logger: options.logger,
          signal,
          stop: stop(),
        })
        .catch(options.onSignalShutdownFailure);
      terminationState.shutdown = shutdown;
      return shutdown;
    };

    const handleTermination = (signal: NodeJS.Signals, exitCode: number): Promise<void> => {
      if (terminationState._tag === "idle") {
        return startTermination(signal, exitCode);
      }
      if (terminationState.admission === "closed" || terminationState.duplicateLog !== null) {
        return terminationState.shutdown;
      }
      terminationState.duplicateLog = runWebBoundary(
        logDuplicateWebTerminationNotice(options.logger, options.reportFailure),
      );
      return terminationState.shutdown;
    };

    return {
      completeAfterHostExit,
      handleTermination,
      registerFrontend: (server) =>
        Effect.suspend(() => {
          if (stopState._tag !== "running") {
            return options.closeFrontend(server);
          }
          frontendState = { _tag: "open", server };
          return Effect.void;
        }),
      registerHost: (backend) =>
        Effect.suspend(() => {
          if (stopState._tag !== "running") {
            hostState = { _tag: "closed" };
            return options.stopResources({
              closeFrontend: () => Effect.void,
              frontendServer: null,
              hostBackend: backend,
            });
          }
          hostState = { _tag: "open", backend };
          return Effect.void;
        }),
      release: () =>
        Effect.gen(function* () {
          closeDuplicateTerminationLogAdmission();
          const stopExit = yield* Effect.exit(stop());
          if (
            stopExit._tag === "Failure" &&
            stopState._tag === "released" &&
            !stopState.failureReported
          ) {
            stopState = { _tag: "released", failureReported: true };
            yield* Effect.sync(() =>
              options.reportFailure(causeToWebBoundaryError(stopExit.cause)),
            );
          }
        }),
      stop,
    };
  });
