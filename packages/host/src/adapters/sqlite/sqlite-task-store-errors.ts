import { Data } from "effect";
import {
  errorMessage,
  HostDependencyError,
  HostInvariantError,
  HostOperationError,
  HostPathAccessError,
  HostPathNotFoundError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";

type SqliteTaskStoreErrorDetails = Readonly<Record<string, unknown>>;

export type SqliteTaskStorePersistenceError = SqliteTaskStoreDataError | TaskStoreError;
export type SqliteTaskStoreReadError = SqliteTaskStoreDataError | TaskStoreError;
export type SqliteTaskStoreWriteError = SqliteTaskStoreDataError | TaskStoreError;

export class SqliteTaskStoreDataError extends Data.TaggedError("SqliteTaskStoreDataError")<{
  readonly message: string;
  readonly field?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: SqliteTaskStoreErrorDetails | undefined;
}> {}

const isTaskStoreError = (cause: unknown): cause is TaskStoreError =>
  cause instanceof HostDependencyError ||
  cause instanceof HostInvariantError ||
  cause instanceof HostOperationError ||
  cause instanceof HostPathAccessError ||
  cause instanceof HostPathNotFoundError ||
  cause instanceof HostResourceError ||
  cause instanceof HostValidationError;

export const mapSqliteTaskStoreAdapterError = (
  operation: string,
  databasePath: string,
  cause: unknown,
): TaskStoreError => {
  if (cause instanceof SqliteTaskStoreDataError) {
    return new HostOperationError({
      operation,
      message: cause.message,
      cause,
      details: {
        databasePath,
        ...(cause.details ?? {}),
        ...(cause.field === undefined ? {} : { field: cause.field }),
      },
    });
  }

  if (isTaskStoreError(cause)) {
    return cause;
  }

  return new HostOperationError({
    operation,
    message: errorMessage(cause),
    cause,
    details: { databasePath },
  });
};
