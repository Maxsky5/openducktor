import { Cause, Chunk, Data, Option } from "effect";

export const jsonIssues = (
  issues: ReadonlyArray<{ code: string; message: string; path: readonly PropertyKey[] }>,
): Array<{ code: string; message: string; path: string[] }> =>
  issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String),
  }));

type ElectronErrorContext<Details extends object> = {
  readonly message: string;
  readonly operation: string;
  readonly arch?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: Details | undefined;
  readonly path?: string | undefined;
  readonly platform?: string | undefined;
};

export class ElectronValidationError<Details extends object = never> extends Data.TaggedError(
  "ElectronValidationError",
)<
  ElectronErrorContext<Details> & {
    readonly field?: string | undefined;
  }
> {}

export class ElectronOperationError<Details extends object = never> extends Data.TaggedError(
  "ElectronOperationError",
)<ElectronErrorContext<Details>> {}

export class ElectronLifecycleError<Details extends object = never> extends Data.TaggedError(
  "ElectronLifecycleError",
)<
  ElectronErrorContext<Details> & {
    readonly reason?: string | undefined;
  }
> {}

export type ElectronValidationErrorAggregate = ElectronValidationError<object>;
export type ElectronOperationErrorAggregate = ElectronOperationError<object>;
export type ElectronLifecycleErrorAggregate = ElectronLifecycleError<object>;

export type ElectronError =
  | ElectronLifecycleErrorAggregate
  | ElectronOperationErrorAggregate
  | ElectronValidationErrorAggregate;

export const isElectronError = (cause: unknown): cause is ElectronError =>
  cause instanceof ElectronLifecycleError ||
  cause instanceof ElectronOperationError ||
  cause instanceof ElectronValidationError;

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const toElectronOperationError = <Details extends object = never>(
  cause: unknown,
  operation: string,
  details?: Details,
): ElectronOperationError<Details> | ElectronOperationErrorAggregate => {
  return cause instanceof ElectronOperationError
    ? cause
    : new ElectronOperationError({
        operation,
        message: errorMessage(cause),
        cause,
        details,
      });
};

export const causeToElectronBoundaryError = <Failure>(
  cause: Cause.Cause<Failure>,
): Failure | ElectronOperationError<{ defect: true }> => {
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
