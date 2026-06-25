import { Cause, Chunk, Data, Option } from "effect";

export type ElectronErrorDetails = Readonly<Record<string, unknown>>;

type ElectronErrorContext = {
  readonly message: string;
  readonly operation: string;
  readonly arch?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: ElectronErrorDetails | undefined;
  readonly path?: string | undefined;
  readonly platform?: string | undefined;
};

export class ElectronValidationError extends Data.TaggedError("ElectronValidationError")<
  ElectronErrorContext & {
    readonly field?: string | undefined;
  }
> {}

export class ElectronOperationError extends Data.TaggedError(
  "ElectronOperationError",
)<ElectronErrorContext> {}

export class ElectronLifecycleError extends Data.TaggedError("ElectronLifecycleError")<
  ElectronErrorContext & {
    readonly reason?: string | undefined;
  }
> {}

export type ElectronError =
  | ElectronLifecycleError
  | ElectronOperationError
  | ElectronValidationError;

export const isElectronError = (cause: unknown): cause is ElectronError =>
  cause instanceof ElectronLifecycleError ||
  cause instanceof ElectronOperationError ||
  cause instanceof ElectronValidationError;

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const toElectronOperationError = (
  cause: unknown,
  operation: string,
  details?: ElectronErrorDetails,
): ElectronOperationError =>
  cause instanceof ElectronOperationError
    ? cause
    : new ElectronOperationError({
        operation,
        message: errorMessage(cause),
        cause,
        details,
      });

export const causeToElectronBoundaryError = <Failure>(
  cause: Cause.Cause<Failure>,
): Failure | ElectronOperationError => {
  const firstFailure = Chunk.head(Cause.failures(cause));
  if (Option.isSome(firstFailure)) {
    return firstFailure.value;
  }

  return new ElectronOperationError({
    operation: "electron.effect.run",
    message: Cause.pretty(cause),
    details: { defect: true },
  });
};
