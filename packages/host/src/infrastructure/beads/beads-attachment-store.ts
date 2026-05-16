import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import {
  type HostPathAccessError,
  type HostPathNotFoundError,
  toHostPathStatError,
} from "../../effect/host-errors";

export const readTextFile = (
  filePath: string,
  operation: string,
): Effect.Effect<string, HostPathAccessError | HostPathNotFoundError> =>
  Effect.tryPromise({
    try: () => readFile(filePath, "utf8"),
    catch: (cause) => toHostPathStatError(cause, operation, filePath),
  });

export const readOptionalTextFile = (
  filePath: string,
  operation: string,
): Effect.Effect<string | null, HostPathAccessError> =>
  readTextFile(filePath, operation).pipe(
    Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(null)),
  );

export const writeTextFile = (
  filePath: string,
  content: string,
  operation: string,
): Effect.Effect<void, HostPathAccessError | HostPathNotFoundError> =>
  Effect.tryPromise({
    try: () => writeFile(filePath, content),
    catch: (cause) => toHostPathStatError(cause, operation, filePath),
  });

export const renamePath = (
  sourcePath: string,
  targetPath: string,
  operation: string,
): Effect.Effect<void, HostPathAccessError | HostPathNotFoundError> =>
  Effect.tryPromise({
    try: () => rename(sourcePath, targetPath),
    catch: (cause) =>
      toHostPathStatError(cause, operation, sourcePath, {
        targetPath,
      }),
  });

export const ensureDirectory = (
  directoryPath: string,
  operation: string,
): Effect.Effect<void, HostPathAccessError | HostPathNotFoundError> =>
  Effect.tryPromise({
    try: () => mkdir(directoryPath, { recursive: true }),
    catch: (cause) => toHostPathStatError(cause, operation, directoryPath),
  }).pipe(Effect.asVoid);
