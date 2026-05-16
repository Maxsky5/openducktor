import { Cause, Chunk, Data, Option } from "effect";

export type HostErrorDetails = Readonly<Record<string, unknown>>;

export class HostValidationError extends Data.TaggedError("HostValidationError")<{
  readonly message: string;
  readonly field?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails | undefined;
}> {}

export class HostCommandError extends Data.TaggedError("HostCommandError")<{
  readonly message: string;
  readonly command?: string | undefined;
  readonly details?: HostErrorDetails | undefined;
}> {}

export class HostDependencyError extends Data.TaggedError("HostDependencyError")<{
  readonly message: string;
  readonly dependency: string;
  readonly operation?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails | undefined;
}> {}

export class HostOperationError extends Data.TaggedError("HostOperationError")<{
  readonly message: string;
  readonly operation: string;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails | undefined;
}> {}

export class HostResourceError extends Data.TaggedError("HostResourceError")<{
  readonly message: string;
  readonly resource: string;
  readonly operation?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails | undefined;
}> {}

export class HostPathAccessError extends Data.TaggedError("HostPathAccessError")<{
  readonly message: string;
  readonly path: string;
  readonly operation: string;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails | undefined;
}> {}

export class HostPathNotFoundError extends Data.TaggedError("HostPathNotFoundError")<{
  readonly message: string;
  readonly path: string;
  readonly operation: string;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails | undefined;
}> {}

export class HostInvariantError extends Data.TaggedError("HostInvariantError")<{
  readonly message: string;
  readonly invariant: string;
  readonly details?: HostErrorDetails | undefined;
}> {}

export type HostError =
  | HostCommandError
  | HostDependencyError
  | HostInvariantError
  | HostOperationError
  | HostPathAccessError
  | HostPathNotFoundError
  | HostResourceError
  | HostValidationError;

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const nodeErrorCode = (cause: unknown): string | null =>
  typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : null;

export const isPathNotFoundError = (cause: unknown): boolean =>
  nodeErrorCode(cause) === "ENOENT" || nodeErrorCode(cause) === "ENOTDIR";

export const toHostPathAccessError = (
  cause: unknown,
  operation: string,
  path: string,
  details?: HostErrorDetails,
): HostPathAccessError =>
  new HostPathAccessError({
    operation,
    path,
    message: errorMessage(cause),
    cause,
    details,
  });

export const toHostPathStatError = (
  cause: unknown,
  operation: string,
  path: string,
  details?: HostErrorDetails,
): HostPathAccessError | HostPathNotFoundError =>
  isPathNotFoundError(cause)
    ? new HostPathNotFoundError({
        operation,
        path,
        message: errorMessage(cause),
        cause,
        details,
      })
    : toHostPathAccessError(cause, operation, path, details);

export const toHostOperationError = (
  cause: unknown,
  operation: string,
  details?: HostErrorDetails,
): HostOperationError => {
  if (
    cause instanceof HostCommandError ||
    cause instanceof HostDependencyError ||
    cause instanceof HostInvariantError ||
    cause instanceof HostOperationError ||
    cause instanceof HostPathAccessError ||
    cause instanceof HostPathNotFoundError ||
    cause instanceof HostResourceError ||
    cause instanceof HostValidationError
  ) {
    return cause instanceof HostOperationError
      ? cause
      : new HostOperationError({
          operation,
          message: cause.message,
          cause,
          details,
        });
  }

  return new HostOperationError({
    operation,
    message: errorMessage(cause),
    cause,
    details,
  });
};

export const causeToHostBoundaryError = <Failure>(
  cause: Cause.Cause<Failure>,
): Failure | HostOperationError => {
  const firstFailure = Chunk.head(Cause.failures(cause));
  if (Option.isSome(firstFailure)) {
    return firstFailure.value;
  }

  return new HostOperationError({
    operation: "host.effect.run",
    message: Cause.pretty(cause),
    details: { defect: true },
  });
};
