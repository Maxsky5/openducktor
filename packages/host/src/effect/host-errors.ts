import { Cause, Chunk, Data, Option } from "effect";
import { z } from "zod";

export type HostErrorDetails<Details extends object> = Readonly<Details>;

export class HostValidationError<Details extends object = never> extends Data.TaggedError(
  "HostValidationError",
)<{
  readonly message: string;
  readonly field?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails<Details>;
}> {}

class HostCommandError<Details extends object = never> extends Data.TaggedError(
  "HostCommandError",
)<{
  readonly message: string;
  readonly command?: string | undefined;
  readonly details?: HostErrorDetails<Details>;
}> {}

export class HostDependencyError<Details extends object = never> extends Data.TaggedError(
  "HostDependencyError",
)<{
  readonly message: string;
  readonly dependency: string;
  readonly operation?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails<Details>;
}> {}

export class HostOperationError<Details extends object = never> extends Data.TaggedError(
  "HostOperationError",
)<{
  readonly message: string;
  readonly operation: string;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails<Details>;
}> {}

export class HostResourceError<Details extends object = never> extends Data.TaggedError(
  "HostResourceError",
)<{
  readonly message: string;
  readonly resource: string;
  readonly operation?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails<Details>;
}> {}

export class HostPathAccessError<Details extends object = never> extends Data.TaggedError(
  "HostPathAccessError",
)<{
  readonly message: string;
  readonly path: string;
  readonly operation: string;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails<Details>;
}> {}

export class HostPathNotFoundError<Details extends object = never> extends Data.TaggedError(
  "HostPathNotFoundError",
)<{
  readonly message: string;
  readonly path: string;
  readonly operation: string;
  readonly cause?: unknown | undefined;
  readonly details?: HostErrorDetails<Details>;
}> {}

export class HostInvariantError<Details extends object = never> extends Data.TaggedError(
  "HostInvariantError",
)<{
  readonly message: string;
  readonly invariant: string;
  readonly details?: HostErrorDetails<Details>;
}> {}

export type HostCommandErrorAggregate = HostCommandError<object>;
export type HostDependencyErrorAggregate = HostDependencyError<object>;
export type HostInvariantErrorAggregate = HostInvariantError<object>;
export type HostOperationErrorAggregate = HostOperationError<object>;
export type HostPathAccessErrorAggregate = HostPathAccessError<object>;
export type HostPathNotFoundErrorAggregate = HostPathNotFoundError<object>;
export type HostResourceErrorAggregate = HostResourceError<object>;
export type HostValidationErrorAggregate = HostValidationError<object>;

export type HostError =
  | HostCommandErrorAggregate
  | HostDependencyErrorAggregate
  | HostInvariantErrorAggregate
  | HostOperationErrorAggregate
  | HostPathAccessErrorAggregate
  | HostPathNotFoundErrorAggregate
  | HostResourceErrorAggregate
  | HostValidationErrorAggregate;

export const isHostError = (cause: unknown): cause is HostError =>
  cause instanceof HostCommandError ||
  cause instanceof HostDependencyError ||
  cause instanceof HostInvariantError ||
  cause instanceof HostOperationError ||
  cause instanceof HostPathAccessError ||
  cause instanceof HostPathNotFoundError ||
  cause instanceof HostResourceError ||
  cause instanceof HostValidationError;

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const nodeErrorCodeSchema = z.object({ code: z.string() });

const nodeErrorCode = (cause: unknown): string | null => {
  const parsed = nodeErrorCodeSchema.safeParse(cause);
  return parsed.success ? parsed.data.code : null;
};

const nestedNodeErrorSchema = z
  .object({ code: z.unknown().optional(), cause: z.unknown().optional() })
  .passthrough();

export const hasNestedNodeErrorCode = (cause: unknown, code: string): boolean => {
  const visited = new Set<unknown>();
  let current: unknown = cause;
  while (!visited.has(current)) {
    visited.add(current);
    const parsed = nestedNodeErrorSchema.safeParse(current);
    if (!parsed.success) {
      return false;
    }
    if (parsed.data.code === code) {
      return true;
    }
    current = parsed.data.cause;
  }
  return false;
};

const isPathNotFoundError = (cause: unknown): boolean =>
  nodeErrorCode(cause) === "ENOENT" || nodeErrorCode(cause) === "ENOTDIR";

const toHostPathAccessError = <Details extends object>(
  cause: unknown,
  operation: string,
  path: string,
  details?: HostErrorDetails<Details>,
): HostPathAccessError<Details> => {
  const message = errorMessage(cause);
  if (details === undefined) {
    return new HostPathAccessError({ operation, path, message, cause });
  }
  return new HostPathAccessError({ operation, path, message, cause, details });
};

export function toHostPathStatError(
  cause: unknown,
  operation: string,
  path: string,
): HostPathAccessError<never> | HostPathNotFoundError<never>;
export function toHostPathStatError<Details extends object>(
  cause: unknown,
  operation: string,
  path: string,
  details: HostErrorDetails<Details>,
): HostPathAccessError<Details> | HostPathNotFoundError<Details>;
export function toHostPathStatError<Details extends object>(
  cause: unknown,
  operation: string,
  path: string,
  details?: HostErrorDetails<Details>,
): HostPathAccessError<Details> | HostPathNotFoundError<Details> {
  if (!isPathNotFoundError(cause)) {
    return toHostPathAccessError(cause, operation, path, details);
  }
  const message = errorMessage(cause);
  if (details === undefined) {
    return new HostPathNotFoundError({ operation, path, message, cause });
  }
  return new HostPathNotFoundError({ operation, path, message, cause, details });
}

export function toHostOperationError(
  cause: unknown,
  operation: string,
): HostOperationError<never> | HostOperationErrorAggregate;
export function toHostOperationError<Details extends object>(
  cause: unknown,
  operation: string,
  details: HostErrorDetails<Details>,
): HostOperationError<Details> | HostOperationErrorAggregate;
export function toHostOperationError<Details extends object>(
  cause: unknown,
  operation: string,
  details?: HostErrorDetails<Details>,
): HostOperationError<Details> | HostOperationErrorAggregate {
  if (isHostError(cause)) {
    if (cause instanceof HostOperationError) {
      return cause;
    }
    if (details === undefined) {
      return new HostOperationError({ operation, message: cause.message, cause });
    }
    return new HostOperationError({ operation, message: cause.message, cause, details });
  }

  const message = errorMessage(cause);
  if (details === undefined) {
    return new HostOperationError({ operation, message, cause });
  }
  return new HostOperationError({ operation, message, cause, details });
}

export const causeToHostBoundaryError = <Failure>(
  cause: Cause.Cause<Failure>,
): Failure | HostOperationError<{ defect: true }> => {
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
