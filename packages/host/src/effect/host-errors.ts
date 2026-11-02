import { runtimeOperationFailureSchema } from "@openducktor/contracts";
import { Cause, Data, Option } from "effect";
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

/** A settings file that the user must correct, back up, or restore before the host can start. */
export class SettingsFileError extends Data.TaggedError("SettingsFileError")<{
  readonly reason: "invalid" | "backupConflict" | "databaseMissing";
  readonly path: string;
  readonly message: string;
  readonly backupPath?: string | undefined;
  readonly cause?: unknown | undefined;
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
  | HostValidationErrorAggregate
  | SettingsFileError;

export const isHostError = (cause: unknown): cause is HostError =>
  cause instanceof HostCommandError ||
  cause instanceof HostDependencyError ||
  cause instanceof HostInvariantError ||
  cause instanceof HostOperationError ||
  cause instanceof HostPathAccessError ||
  cause instanceof HostPathNotFoundError ||
  cause instanceof HostResourceError ||
  cause instanceof HostValidationError ||
  cause instanceof SettingsFileError;

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Lists the message of each failure, then of each defect, without tags or stacks. */
export const causeMessages = (cause: Cause.Cause<unknown>): string[] => {
  const failures = cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error);
  const defects = cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect);
  const messages = [...failures, ...defects].map(errorMessage);
  return messages.length > 0 ? messages : ["The operation was interrupted."];
};

/** Describes a cause for users: the message of each failure and defect, without tags or stacks. */
export const causeMessage = (cause: Cause.Cause<unknown>): string =>
  causeMessages(cause).join("\n");

const nodeErrorCodeSchema = z.object({ code: z.string() });

const nodeErrorCode = (cause: unknown): string | null => {
  const parsed = nodeErrorCodeSchema.safeParse(cause);
  return parsed.success ? parsed.data.code : null;
};

const errorCauseSchema = z.looseObject({ cause: z.unknown().optional() });

/** Returns the first error in the `cause` chain, from `cause` inward, that matches `predicate`. */
export const findInCauseChain = <Match>(
  cause: unknown,
  predicate: (cause: unknown) => cause is Match,
): Match | null => {
  const visited = new Set<unknown>();
  let current = cause;
  while (!visited.has(current)) {
    visited.add(current);
    if (predicate(current)) return current;
    const parsed = errorCauseSchema.safeParse(current);
    if (!parsed.success) return null;
    current = parsed.data.cause;
  }
  return null;
};

export const hasNestedNodeErrorCode = (cause: unknown, code: string): boolean =>
  findInCauseChain(cause, (link): link is { code: string } => nodeErrorCode(link) === code) !==
  null;

/** A Node error for a path that does not exist or has a file in place of a directory. */
export const isPathNotFoundError = (cause: unknown): cause is { code: "ENOENT" | "ENOTDIR" } =>
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
  const firstFailure = Cause.findErrorOption(cause);
  if (Option.isSome(firstFailure)) {
    return firstFailure.value;
  }

  return new HostOperationError({
    operation: "host.effect.run",
    message: Cause.pretty(cause),
    details: { defect: true },
  });
};

export const readRuntimeOperationFailure = (
  cause: unknown,
):
  | {
      kind: "runtime_operation";
      runtimeOperationFailure: import("@openducktor/contracts").RuntimeOperationFailure;
    }
  | undefined => {
  const parsed = z
    .object({
      failure: z.object({
        kind: z.literal("runtime_operation"),
        runtimeOperationFailure: runtimeOperationFailureSchema,
      }),
    })
    .safeParse(cause);
  if (parsed.success) return parsed.data.failure;
  if (cause instanceof HostOperationError && cause.cause !== cause)
    return readRuntimeOperationFailure(cause.cause);
  return undefined;
};
