import { Cause, Data, Effect, Exit } from "effect";

export type WebErrorDetails = Readonly<Record<string, unknown>>;

export class WebValidationError extends Data.TaggedError("WebValidationError")<{
  readonly message: string;
  readonly field?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: WebErrorDetails | undefined;
}> {}

export class WebDependencyError extends Data.TaggedError("WebDependencyError")<{
  readonly message: string;
  readonly dependency: string;
  readonly operation?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: WebErrorDetails | undefined;
}> {}

export class WebOperationError extends Data.TaggedError("WebOperationError")<{
  readonly message: string;
  readonly operation: string;
  readonly cause?: unknown | undefined;
  readonly details?: WebErrorDetails | undefined;
}> {}

export class WebResourceError extends Data.TaggedError("WebResourceError")<{
  readonly message: string;
  readonly resource: string;
  readonly operation?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: WebErrorDetails | undefined;
}> {}

export class WebHostRequestError extends Data.TaggedError("WebHostRequestError")<{
  readonly message: string;
  readonly status: number;
  readonly failureKind?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: WebErrorDetails | undefined;
}> {}

export type WebError =
  | WebDependencyError
  | WebHostRequestError
  | WebOperationError
  | WebResourceError
  | WebValidationError;

export const isWebError = (cause: unknown): cause is WebError =>
  cause instanceof WebDependencyError ||
  cause instanceof WebHostRequestError ||
  cause instanceof WebOperationError ||
  cause instanceof WebResourceError ||
  cause instanceof WebValidationError;

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const combineWebErrors = (
  operation: string,
  message: string,
  failures: readonly WebError[],
): WebError | null => {
  if (failures.length === 0) {
    return null;
  }
  if (failures.length === 1) {
    return failures[0] ?? null;
  }
  return new WebOperationError({
    operation,
    message,
    cause: failures[0],
    details: { failures },
  });
};

export const toWebOperationError = (
  cause: unknown,
  operation: string,
  details?: WebErrorDetails,
): WebOperationError => {
  if (cause instanceof WebOperationError) {
    return cause;
  }
  if (isWebError(cause)) {
    return new WebOperationError({
      operation,
      message: cause.message,
      cause,
      details,
    });
  }

  return new WebOperationError({
    operation,
    message: errorMessage(cause),
    cause,
    details,
  });
};

export const causeToWebBoundaryError = <Failure>(
  cause: Cause.Cause<Failure>,
): Failure | WebOperationError => {
  const failures = Array.from(Cause.failures(cause));
  const hasOnlyTypedFailures = !Cause.isDie(cause) && !Cause.isInterrupted(cause);
  if (failures.length === 1 && hasOnlyTypedFailures) {
    const firstFailure = failures[0];
    if (firstFailure !== undefined) {
      return firstFailure;
    }
  }
  if (failures.length > 1 && hasOnlyTypedFailures) {
    return new WebOperationError({
      operation: "web.effect.run",
      message: "Multiple Effect failures crossed the web boundary.",
      cause: { failures },
      details: { failureMessages: failures.map(errorMessage) },
    });
  }

  return new WebOperationError({
    operation: "web.effect.run",
    message: Cause.pretty(cause),
    cause,
    details: {
      defect: Cause.isDie(cause),
      failureMessages: failures.map(errorMessage),
      interrupted: Cause.isInterrupted(cause),
    },
  });
};

export const runWebBoundary = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw causeToWebBoundaryError(exit.cause);
};

export const runWebSyncBoundary = <A, E>(effect: Effect.Effect<A, E>): A => {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw causeToWebBoundaryError(exit.cause);
};
