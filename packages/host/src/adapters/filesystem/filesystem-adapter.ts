import { createHash } from "node:crypto";
import { access, lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { toHostOperationError, toHostPathStatError } from "../../effect/host-errors";
import {
  type FilesystemDirectoryEntry,
  FilesystemFileOperationError,
  type FilesystemFileSnapshot,
  type FilesystemPort,
} from "../../ports/filesystem-port";
import { readBoundedFileBytes } from "./bounded-file-read";
import { conditionallyReplaceOpenFile } from "./conditional-file-replace";

const revisionForFile = (bytes: Uint8Array, identity: { dev: number; ino: number }): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}:file:${identity.dev}:${identity.ino}`;

const nodeErrorCode = (cause: unknown): string | null =>
  typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : null;

const fileOperationError = (
  cause: unknown,
  operation: "read_snapshot" | "replace",
  inputPath: string,
): FilesystemFileOperationError => {
  const code = nodeErrorCode(cause);
  const operationCode =
    code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR" || code === "ELOOP"
      ? "unavailable_file"
      : code === "EACCES" || code === "EPERM"
        ? "permission_denied"
        : "io_failure";
  return new FilesystemFileOperationError({
    code: operationCode,
    operation,
    path: inputPath,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
};

const snapshotOpenFile = async (
  file: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
): Promise<FilesystemFileSnapshot> => {
  const [bytes, metadata] = await Promise.all([readBoundedFileBytes(file, maxBytes), file.stat()]);
  return {
    bytes,
    isFile: metadata.isFile(),
    size: Math.max(metadata.size, bytes.byteLength),
    mtimeMs: Number.isFinite(metadata.mtimeMs) ? metadata.mtimeMs : null,
    revision: revisionForFile(bytes, metadata),
  };
};

const writeAllBytes = async (
  file: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> => {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesWritten === 0) {
      throw new Error("The filesystem wrote zero bytes before the file was complete.");
    }
    offset += bytesWritten;
  }
};

const isContainedPath = (rootPath: string, targetPath: string): boolean => {
  const relativePath = path.relative(rootPath, targetPath);
  const leavesRoot = relativePath === ".." || relativePath.startsWith(`..${path.sep}`);
  return relativePath === "" || (!leavesRoot && !path.isAbsolute(relativePath));
};

const unavailableFile = (inputPath: string, message: string): FilesystemFileOperationError =>
  new FilesystemFileOperationError({
    code: "unavailable_file",
    operation: "replace",
    path: inputPath,
    message,
  });

const verifyOpenFileContainment = async (
  file: Awaited<ReturnType<typeof open>>,
  canonicalRootPath: string,
  inputPath: string,
): Promise<void> => {
  const currentCanonicalRoot = await realpath(canonicalRootPath);
  if (path.relative(currentCanonicalRoot, path.resolve(canonicalRootPath)) !== "") {
    throw unavailableFile(inputPath, "The workspace root changed after the file was loaded.");
  }
  if (!isContainedPath(currentCanonicalRoot, path.resolve(inputPath))) {
    throw unavailableFile(inputPath, "The selected path is outside the workspace root.");
  }

  const canonicalTarget = await realpath(inputPath);
  if (!isContainedPath(currentCanonicalRoot, canonicalTarget)) {
    throw unavailableFile(inputPath, "The selected file moved outside the workspace root.");
  }
  if (path.relative(path.resolve(inputPath), canonicalTarget) !== "") {
    throw unavailableFile(inputPath, "The selected file moved after it was loaded.");
  }

  const [openedMetadata, targetMetadata] = await Promise.all([file.stat(), stat(canonicalTarget)]);
  if (openedMetadata.dev !== targetMetadata.dev || openedMetadata.ino !== targetMetadata.ino) {
    throw unavailableFile(inputPath, "The selected path changed while the file was opened.");
  }
};

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
      return entries.map((entry): FilesystemDirectoryEntry => ({
        name: entry.name,
        path: path.join(inputPath, entry.name),
      }));
    });
  },
  readFileBytes(inputPath, maxBytes) {
    return Effect.tryPromise({
      try: async () => {
        const file = await open(inputPath, "r");
        try {
          return await readBoundedFileBytes(file, maxBytes);
        } finally {
          await file.close();
        }
      },
      catch: (cause) =>
        toHostOperationError(cause, "filesystem.readFileBytes", {
          path: inputPath,
          maxBytes,
        }),
    });
  },
  readFileSnapshot(inputPath, maxBytes) {
    return Effect.tryPromise({
      try: async () => {
        const file = await open(inputPath, "r");
        try {
          return await snapshotOpenFile(file, maxBytes);
        } finally {
          await file.close();
        }
      },
      catch: (cause) => fileOperationError(cause, "read_snapshot", inputPath),
    });
  },
  replaceFileBytes({
    canonicalRootPath,
    path: inputPath,
    expectedRevision,
    bytes,
    maxCurrentBytes,
  }) {
    return Effect.tryPromise({
      try: async () => {
        const file = await open(inputPath, "r+");
        try {
          return await conditionallyReplaceOpenFile({
            inputPath,
            expectedRevision,
            bytes,
            maxCurrentBytes,
            verifyEntry: () => verifyOpenFileContainment(file, canonicalRootPath, inputPath),
            snapshot: () => snapshotOpenFile(file, maxCurrentBytes + 1),
            truncate: () => file.truncate(0),
            write: (replacement) => writeAllBytes(file, replacement),
            sync: () => file.sync(),
          });
        } finally {
          await file.close();
        }
      },
      catch: (cause) =>
        cause instanceof FilesystemFileOperationError
          ? cause
          : fileOperationError(cause, "replace", inputPath),
    });
  },
  stat(inputPath, options) {
    return Effect.gen(function* () {
      const metadata = yield* Effect.tryPromise({
        try: () => (options?.followSymbolicLinks === false ? lstat(inputPath) : stat(inputPath)),
        catch: (cause) =>
          toHostOperationError(cause, "filesystem.stat", {
            path: inputPath,
          }),
      });
      return {
        isDirectory: metadata.isDirectory(),
        isFile: metadata.isFile(),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
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
  relative(from, to) {
    return path.relative(from, to);
  },
  parent(inputPath) {
    const parentPath = path.dirname(inputPath);
    return parentPath === inputPath ? null : parentPath;
  },
});
