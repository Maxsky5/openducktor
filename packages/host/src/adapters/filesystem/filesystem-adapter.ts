import { access, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { toHostOperationError, toHostPathStatError } from "../../effect/host-errors";
import type { FilesystemDirectoryEntry, FilesystemPort } from "../../ports/filesystem-port";

export const createFilesystemAdapter = (): FilesystemPort => ({
  homeDirectory() {
    const home = homedir();
    return home.trim().length > 0 ? home : null;
  },
  canonicalize(inputPath) {
    return Effect.tryPromise({
      try: () => realpath(inputPath),
      catch: (cause) =>
        toHostOperationError(cause, "filesystem.canonicalize", {
          path: inputPath,
        }),
    });
  },
  readDirectory(inputPath) {
    return Effect.gen(function* () {
      const entries = yield* Effect.tryPromise({
        try: () => readdir(inputPath, { withFileTypes: true }),
        catch: (cause) =>
          toHostOperationError(cause, "filesystem.readDirectory", { path: inputPath }),
      });
      return entries.map(
        (entry): FilesystemDirectoryEntry => ({
          name: entry.name,
          path: path.join(inputPath, entry.name),
        }),
      );
    });
  },
  stat(inputPath) {
    return Effect.gen(function* () {
      const metadata = yield* Effect.tryPromise({
        try: () => stat(inputPath),
        catch: (cause) =>
          toHostOperationError(cause, "filesystem.stat", {
            path: inputPath,
          }),
      });
      return {
        isDirectory: metadata.isDirectory(),
      };
    });
  },
  exists(inputPath) {
    return Effect.tryPromise({
      try: () => access(inputPath),
      catch: (cause) => toHostPathStatError(cause, "filesystem.exists", inputPath),
    }).pipe(
      Effect.as(true),
      Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
    );
  },
  join(...paths) {
    return path.join(...paths);
  },
  parent(inputPath) {
    const parentPath = path.dirname(inputPath);
    return parentPath === inputPath ? null : parentPath;
  },
});
