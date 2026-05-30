import { type DirectoryListing, directoryListingSchema } from "@openducktor/contracts";
import { normalizeUserPathInput, resolveNormalizedUserPath } from "@openducktor/path-support";
import { Data, Effect } from "effect";
import type { FilesystemPort } from "../../ports/filesystem-port";
export type FilesystemListDirectoryErrorKind =
  | "home_directory_unavailable"
  | "invalid_path"
  | "directory_does_not_exist"
  | "path_is_not_directory"
  | "read_failed";
export class FilesystemListDirectoryError extends Data.TaggedError("FilesystemListDirectoryError")<{
  readonly kind: FilesystemListDirectoryErrorKind;
  readonly message: string;
  readonly cause?: unknown | undefined;
}> {
  constructor(kind: FilesystemListDirectoryErrorKind, message: string, options?: ErrorOptions) {
    super(
      options?.cause === undefined ? { kind, message } : { kind, message, cause: options.cause },
    );
  }
}
export type FilesystemListDirectoryInput = {
  path?: string;
};
export type FilesystemService = {
  listDirectory(
    input?: FilesystemListDirectoryInput,
  ): Effect.Effect<DirectoryListing, FilesystemListDirectoryError>;
};
const hasNodeErrorCode = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (
    error as {
      code?: unknown;
    }
  ).code === code;
const resolveHome = (filesystem: FilesystemPort): string => {
  const home = filesystem.homeDirectory();
  if (home) {
    return home;
  }
  throw new FilesystemListDirectoryError(
    "home_directory_unavailable",
    "Unable to resolve the user home directory.",
  );
};
const resolveUserPath = (filesystem: FilesystemPort, rawPath: string): string => {
  const normalizedPath = normalizeUserPathInput(rawPath);
  if (!normalizedPath) {
    throw new FilesystemListDirectoryError("invalid_path", "Path is empty; provide a valid path");
  }
  return resolveNormalizedUserPath(normalizedPath, {
    resolveHomeDir: () => resolveHome(filesystem),
    joinHomePath: (homeDir, relativePath) => filesystem.join(homeDir, relativePath),
  });
};
const resolveRequestedPath = (filesystem: FilesystemPort, rawPath: string | undefined): string => {
  if (rawPath !== undefined) {
    return resolveUserPath(filesystem, rawPath);
  }
  return resolveHome(filesystem);
};
const canonicalizeDirectoryEffect = (
  filesystem: FilesystemPort,
  requestedPath: string,
): Effect.Effect<string, FilesystemListDirectoryError> =>
  Effect.gen(function* () {
    const currentPath = yield* filesystem.canonicalize(requestedPath).pipe(
      Effect.mapError((error) => {
        if (hasNodeErrorCode(error, "ENOENT")) {
          return new FilesystemListDirectoryError(
            "directory_does_not_exist",
            `Directory does not exist: ${requestedPath}`,
            { cause: error },
          );
        }
        return new FilesystemListDirectoryError(
          "read_failed",
          `Failed to read directory '${requestedPath}': ${String(error)}`,
          { cause: error },
        );
      }),
    );
    const metadata = yield* filesystem
      .stat(currentPath)
      .pipe(
        Effect.mapError(
          (error) =>
            new FilesystemListDirectoryError(
              "read_failed",
              `Failed to read directory '${currentPath}': ${String(error)}`,
              { cause: error },
            ),
        ),
      );
    if (!metadata.isDirectory) {
      return yield* Effect.fail(
        new FilesystemListDirectoryError(
          "path_is_not_directory",
          `Path is not a directory: ${currentPath}`,
        ),
      );
    }
    return currentPath;
  });
const pathExistsEffect = (filesystem: FilesystemPort, inputPath: string) =>
  filesystem.exists(inputPath).pipe(
    Effect.mapError(
      (error) =>
        new FilesystemListDirectoryError(
          "read_failed",
          `Failed to inspect '${inputPath}': ${error.message}`,
          {
            cause: error,
          },
        ),
    ),
  );
const readDirectoryEntriesEffect = (filesystem: FilesystemPort, currentPath: string) =>
  Effect.gen(function* () {
    const entries = yield* filesystem
      .readDirectory(currentPath)
      .pipe(
        Effect.mapError(
          (error) =>
            new FilesystemListDirectoryError(
              "read_failed",
              `Failed to read directory '${currentPath}': ${String(error)}`,
              { cause: error },
            ),
        ),
      );
    const directories = [];
    for (const entry of entries) {
      const metadata = yield* filesystem
        .stat(entry.path)
        .pipe(
          Effect.mapError(
            (error) =>
              new FilesystemListDirectoryError(
                "read_failed",
                `Failed to read directory '${currentPath}': ${String(error)}`,
                { cause: error },
              ),
          ),
        );
      if (!metadata.isDirectory) {
        continue;
      }
      directories.push({
        name: entry.name,
        path: entry.path,
        isDirectory: true,
        isGitRepo: yield* pathExistsEffect(filesystem, filesystem.join(entry.path, ".git")),
      });
    }
    directories.sort((left, right) => {
      const insensitive = left.name.toLowerCase().localeCompare(right.name.toLowerCase());
      return insensitive === 0 ? left.name.localeCompare(right.name) : insensitive;
    });
    return directories;
  });
export const createFilesystemService = (filesystem: FilesystemPort): FilesystemService => ({
  listDirectory(input) {
    return Effect.gen(function* () {
      const requestedPath = yield* Effect.try({
        try: () => resolveRequestedPath(filesystem, input?.path),
        catch: (error) =>
          error instanceof FilesystemListDirectoryError
            ? error
            : new FilesystemListDirectoryError("invalid_path", String(error), { cause: error }),
      });
      const currentPath = yield* canonicalizeDirectoryEffect(filesystem, requestedPath);
      const home = filesystem.homeDirectory();
      const homePath = home
        ? yield* filesystem
            .canonicalize(home)
            .pipe(
              Effect.mapError(
                (error) =>
                  new FilesystemListDirectoryError(
                    "read_failed",
                    `Failed to resolve home directory '${home}': ${String(error)}`,
                    { cause: error },
                  ),
              ),
            )
        : null;
      const listing = {
        currentPath,
        currentPathIsGitRepo: yield* pathExistsEffect(
          filesystem,
          filesystem.join(currentPath, ".git"),
        ),
        parentPath: filesystem.parent(currentPath),
        homePath,
        entries: yield* readDirectoryEntriesEffect(filesystem, currentPath),
      };
      return directoryListingSchema.parse(listing);
    });
  },
});
