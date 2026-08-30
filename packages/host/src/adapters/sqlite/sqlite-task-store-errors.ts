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
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { TaskDocumentKind } from "./sqlite-task-store-schema";

export type SqliteTaskStorePersistenceError = SqliteTaskStoreDataError | TaskStoreError;
export type SqliteTaskStoreReadError = SqliteTaskStoreDataError | TaskStoreError;
export type SqliteTaskStoreWriteError = SqliteTaskStoreDataError | TaskStoreError;

type SqliteTaskStoreAdapterErrorDetails = {
  databasePath: string;
  field?: string;
};

export type SqliteTaskStoreDataErrorDetails =
  | { readonly taskId: string }
  | {
      readonly kind: TaskDocumentKind;
      readonly taskId: string;
      readonly value: number;
    };

export class SqliteTaskStoreDataError extends Data.TaggedError("SqliteTaskStoreDataError")<{
  readonly message: string;
  readonly field?: string | undefined;
  readonly cause?: unknown | undefined;
  readonly details?: Readonly<SqliteTaskStoreDataErrorDetails>;
}> {}

const isTaskStoreError = (cause: unknown): cause is TaskStoreError =>
  cause instanceof TaskAssetError ||
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
    const details: SqliteTaskStoreAdapterErrorDetails = {
      databasePath,
      ...cause.details,
    };
    if (cause.field !== undefined) {
      details.field = cause.field;
    }
    return new HostOperationError({
      operation,
      message: cause.message,
      cause,
      details,
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
