import { Data } from "effect";
import { HostDatabaseImportSourceError } from "../../adapters/sqlite/host-database-import-worker-protocol";
import { errorMessage, findInCauseChain } from "../../effect/host-errors";

/** A failure of host storage startup: the settings file check, the legacy import, the settings migration, or the database setup. */
export class HostStorageStartupError extends Data.TaggedError("HostStorageStartupError")<{
  readonly message: string;
  readonly cause: unknown;
  /** The source file that the user must correct, when the failure names one. */
  readonly sourcePath?: string | undefined;
}> {}

export const toHostStorageStartupError = (cause: unknown): HostStorageStartupError =>
  new HostStorageStartupError({
    message: errorMessage(cause),
    cause,
    ...(cause instanceof HostDatabaseImportSourceError && { sourcePath: cause.sourcePath }),
  });

const isHostStorageStartupError = (cause: unknown): cause is HostStorageStartupError =>
  cause instanceof HostStorageStartupError;

/** Finds the error that stopped startup because of host storage. Shells show it in their startup error view. */
export const findHostStorageStartupError = (cause: unknown): HostStorageStartupError | null =>
  findInCauseChain(cause, isHostStorageStartupError);

/** The message to show the user, with the failed source path when the message does not hold it. */
export const formatHostStorageStartupError = (error: HostStorageStartupError): string => {
  const { sourcePath } = error;
  if (sourcePath === undefined || error.message.includes(sourcePath)) return error.message;
  return `${error.message}\n\nSource: ${sourcePath}`;
};
