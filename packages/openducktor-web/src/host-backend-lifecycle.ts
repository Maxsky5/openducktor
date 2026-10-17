import { Cause, Effect } from "effect";
import {
  causeToWebBoundaryError,
  combineWebErrors,
  errorMessage,
  runWebBoundary,
  toWebOperationError,
  type WebError,
  WebOperationError,
} from "@openducktor/remote-host/effect/web-errors";
import { type WebLogger, writeWebLogEffect } from "./logger";

type StopHostBackendInput = {
  disposeHost: () => Effect.Effect<void, unknown>;
  logger: WebLogger;
  resolveExited: (exitCode: number) => void;
  stopServer: () => void | Promise<void>;
};

export const stopHostBackendEffect = ({
  disposeHost,
  logger,
  resolveExited,
  stopServer,
}: StopHostBackendInput): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    let exitCode = 0;
    const failures: WebError[] = [];
    const disposeExit = yield* Effect.exit(disposeHost());
    if (disposeExit._tag === "Failure") {
      exitCode = 1;
      failures.push(
        toWebOperationError(causeToWebBoundaryError(disposeExit.cause), "web.host.dispose"),
      );
      const logResult = yield* Effect.result(
        writeWebLogEffect(logger, "error", Cause.pretty(disposeExit.cause)),
      );
      if (logResult._tag === "Failure") {
        failures.push(logResult.failure);
      }
    }
    const stopServerResult = yield* Effect.result(
      Effect.tryPromise({
        try: async () => {
          await stopServer();
        },
        catch: (cause) =>
          new WebOperationError({
            operation: "web.host.stop-server",
            message: errorMessage(cause),
            cause,
          }),
      }),
    );
    if (stopServerResult._tag === "Failure") {
      exitCode = 1;
      failures.push(stopServerResult.failure);
    }
    resolveExited(exitCode);
    const failure = combineWebErrors(
      "web.host.shutdown",
      "OpenDucktor TypeScript host shutdown failed.",
      failures,
    );
    if (failure) {
      return yield* failure;
    }
  });

export const stopHostBackend = (input: StopHostBackendInput): Promise<void> =>
  runWebBoundary(stopHostBackendEffect(input));
