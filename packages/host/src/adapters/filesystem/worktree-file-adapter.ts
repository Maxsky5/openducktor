import { cp, lstat, mkdir, readdir, readlink, realpath, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { Effect, Layer } from "effect";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  type WorktreeFileError,
  type WorktreeFilePort,
  WorktreeFilePortTag,
} from "../../ports/worktree-file-port";

const metadataDirectoryName = ".git";
const normalizeMissingPath = (inputPath: string): string => path.resolve(inputPath);
const hasErrorCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;
const normalizeForComparison = (inputPath: string) =>
  Effect.tryPromise({
    try: () => realpath(inputPath),
    catch: (cause) =>
      toHostOperationError(cause, "worktreeFile.normalizeForComparison", {
        path: inputPath,
      }),
  }).pipe(
    Effect.catchAll((error) => {
      if (hasErrorCode(error.cause, "ENOENT")) {
        return Effect.succeed(normalizeMissingPath(inputPath));
      }
      return Effect.fail(
        new HostOperationError({
          operation: "worktreeFile.normalizeForComparison",
          message: `Failed resolving path ${inputPath}: ${error.message}`,
          cause: error,
          details: { path: inputPath },
        }),
      );
    }),
  );
const ensureRelativeCopyPath = (relativePath: string): string => {
  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new HostValidationError({
      field: "relativePath",
      message: "Configured worktree copy path cannot be empty",
    });
  }
  if (path.isAbsolute(trimmed)) {
    throw new HostValidationError({
      field: "relativePath",
      message: `Configured worktree copy path must be relative: ${relativePath}`,
      details: { relativePath },
    });
  }
  const normalized = path.normalize(trimmed);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new HostValidationError({
      field: "relativePath",
      message: `Configured worktree copy path cannot traverse outside the repository: ${relativePath}`,
      details: { relativePath },
    });
  }
  const components = normalized.split(path.sep);
  if (components.includes(metadataDirectoryName)) {
    throw new HostValidationError({
      field: "relativePath",
      message: `Configured worktree copy path cannot include the repository metadata directory: ${relativePath}`,
      details: { relativePath },
    });
  }
  return normalized;
};
const ensurePathWithinRoot = (
  rootPath: string,
  candidatePath: string,
  original: string,
  role: string,
): Effect.Effect<void, WorktreeFileError> =>
  Effect.gen(function* () {
    const root = yield* normalizeForComparison(rootPath);
    const candidate = yield* normalizeForComparison(candidatePath);
    if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
      return;
    }
    return yield* Effect.fail(
      new HostValidationError({
        field: role,
        message: `Configured worktree copy ${role} escapes its root: ${original}`,
        details: { rootPath, candidatePath, original, role },
      }),
    );
  });
const ensureNoSymlinkedDestinationComponents = (
  worktreePath: string,
  relativePath: string,
  original: string,
): Effect.Effect<void, WorktreeFileError> =>
  Effect.gen(function* () {
    const components = relativePath.split(path.sep);
    let current = worktreePath;
    for (const component of components.slice(0, -1)) {
      current = path.join(current, component);
      const stats = yield* Effect.tryPromise({
        try: () => lstat(current),
        catch: (cause) =>
          toHostOperationError(cause, "worktreeFile.lstatDestinationComponent", { path: current }),
      }).pipe(
        Effect.catchAll((error) =>
          hasErrorCode(error.cause, "ENOENT") ? Effect.succeed(null) : Effect.fail(error),
        ),
      );
      if (!stats) {
        return;
      }
      if (stats.isSymbolicLink()) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "relativePath",
            message: `Configured worktree copy destination cannot use symlinked path components: ${original}`,
            details: { worktreePath, relativePath, original, componentPath: current },
          }),
        );
      }
    }
  });
const validateSourceTree = (
  repoPath: string,
  sourcePath: string,
  original: string,
): Effect.Effect<void, WorktreeFileError> =>
  Effect.gen(function* () {
    const stats = yield* Effect.tryPromise({
      try: () => lstat(sourcePath),
      catch: (cause) =>
        toHostOperationError(cause, "worktreeFile.lstatSource", {
          path: sourcePath,
        }),
    }).pipe(
      Effect.mapError(
        (error) =>
          new HostOperationError({
            operation: "worktreeFile.lstatSource",
            message: `Configured worktree copy source is unavailable: ${sourcePath}`,
            cause: error,
            details: { sourcePath },
          }),
      ),
    );
    if (stats.isSymbolicLink()) {
      const target = yield* Effect.tryPromise({
        try: () => readlink(sourcePath),
        catch: (cause) =>
          toHostOperationError(cause, "worktreeFile.readSourceSymlink", { path: sourcePath }),
      });
      if (path.isAbsolute(target)) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "relativePath",
            message: `Configured worktree copy source cannot include absolute symlink: ${original}`,
            details: { repoPath, sourcePath, original, target },
          }),
        );
      }
      yield* ensurePathWithinRoot(
        repoPath,
        path.resolve(path.dirname(sourcePath), target),
        original,
        "source",
      );
      return;
    }
    if (stats.isDirectory()) {
      const entries = yield* Effect.tryPromise({
        try: () => readdir(sourcePath),
        catch: (cause) =>
          toHostOperationError(cause, "worktreeFile.readSourceDirectory", { path: sourcePath }),
      });
      for (const entry of entries) {
        yield* validateSourceTree(repoPath, path.join(sourcePath, entry), `${original}/${entry}`);
      }
      return;
    }
    yield* ensurePathWithinRoot(repoPath, sourcePath, original, "source");
  });
const copyPath = (
  repoPath: string,
  worktreePath: string,
  relativePath: string,
): Effect.Effect<void, WorktreeFileError> =>
  Effect.gen(function* () {
    const sourcePath = path.join(repoPath, relativePath);
    const destinationPath = path.join(worktreePath, relativePath);
    const stats = yield* Effect.tryPromise({
      try: () => lstat(sourcePath),
      catch: (cause) =>
        toHostOperationError(cause, "worktreeFile.lstatCopySource", { path: sourcePath }),
    }).pipe(
      Effect.mapError(
        (error) =>
          new HostOperationError({
            operation: "worktreeFile.lstatCopySource",
            message: `Configured worktree copy source is unavailable: ${sourcePath}`,
            cause: error,
            details: { sourcePath },
          }),
      ),
    );
    yield* validateSourceTree(repoPath, sourcePath, relativePath);
    yield* ensureNoSymlinkedDestinationComponents(worktreePath, relativePath, relativePath);
    yield* ensurePathWithinRoot(
      worktreePath,
      path.dirname(destinationPath),
      relativePath,
      "destination",
    );
    if (stats.isDirectory()) {
      yield* Effect.tryPromise({
        try: () =>
          cp(sourcePath, destinationPath, {
            dereference: false,
            errorOnExist: false,
            force: true,
            preserveTimestamps: true,
            recursive: true,
          }),
        catch: (cause) =>
          toHostOperationError(cause, "worktreeFile.copyDirectory", {
            sourcePath,
            destinationPath,
          }),
      });
      return;
    }
    yield* Effect.tryPromise({
      try: () => mkdir(path.dirname(destinationPath), { recursive: true }),
      catch: (cause) =>
        toHostOperationError(cause, "worktreeFile.ensureDestinationDirectory", {
          destinationPath,
        }),
    }).pipe(Effect.asVoid);
    if (stats.isSymbolicLink()) {
      yield* Effect.tryPromise({
        try: () => rm(destinationPath, { force: true, recursive: true }),
        catch: (cause) =>
          toHostOperationError(cause, "worktreeFile.removeExistingSymlinkDestination", {
            destinationPath,
          }),
      });
      const linkTarget = yield* Effect.tryPromise({
        try: () => readlink(sourcePath),
        catch: (cause) =>
          toHostOperationError(cause, "worktreeFile.readCopySymlink", { sourcePath }),
      });
      yield* Effect.tryPromise({
        try: () => symlink(linkTarget, destinationPath),
        catch: (cause) =>
          toHostOperationError(cause, "worktreeFile.createSymlink", {
            sourcePath,
            destinationPath,
          }),
      });
      return;
    }
    if (!stats.isFile()) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "relativePath",
          message: `Configured worktree copy source is not a file or directory: ${sourcePath}`,
          details: { sourcePath, relativePath },
        }),
      );
    }
    yield* Effect.tryPromise({
      try: () =>
        cp(sourcePath, destinationPath, {
          dereference: false,
          errorOnExist: false,
          force: true,
          preserveTimestamps: true,
        }),
      catch: (cause) =>
        toHostOperationError(cause, "worktreeFile.copyFile", { sourcePath, destinationPath }),
    });
  });
export const createWorktreeFileAdapter = (): WorktreeFilePort => ({
  ensureDirectory(inputPath) {
    return Effect.tryPromise({
      try: () => mkdir(inputPath, { recursive: true }),
      catch: (cause) =>
        toHostOperationError(cause, "worktreeFile.ensureDirectory", { path: inputPath }),
    }).pipe(Effect.asVoid);
  },
  copyConfiguredPaths(repoPath, worktreePath, relativePaths) {
    return Effect.gen(function* () {
      const worktreeRoot = yield* Effect.tryPromise({
        try: () => realpath(worktreePath),
        catch: (cause) =>
          toHostOperationError(cause, "worktreeFile.resolveWorktreePathForCopy", { worktreePath }),
      }).pipe(
        Effect.mapError(
          (error) =>
            new HostOperationError({
              operation: "worktreeFile.resolveWorktreePathForCopy",
              message: `Failed resolving worktree path before copying configured paths: ${worktreePath}`,
              details: { worktreePath },
              cause: error,
            }),
        ),
      );
      const repoRoot = yield* Effect.tryPromise({
        try: () => realpath(repoPath),
        catch: (cause) =>
          toHostOperationError(cause, "worktreeFile.resolveRepoPathForCopy", { repoPath }),
      }).pipe(
        Effect.mapError(
          (error) =>
            new HostOperationError({
              operation: "worktreeFile.resolveRepoPathForCopy",
              message: `Failed resolving repository path before copying configured paths: ${repoPath}`,
              details: { repoPath },
              cause: error,
            }),
        ),
      );
      for (const relativePath of relativePaths) {
        const normalizedRelativePath = yield* Effect.try({
          try: () => ensureRelativeCopyPath(relativePath),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? cause
              : toHostOperationError(cause, "worktreeFile.ensureRelativeCopyPath", {
                  relativePath,
                }),
        });
        yield* copyPath(repoRoot, worktreeRoot, normalizedRelativePath);
      }
    });
  },
  removePathIfPresent(inputPath) {
    return Effect.tryPromise({
      try: () => rm(inputPath, { force: true, recursive: true }),
      catch: (cause) =>
        toHostOperationError(cause, "worktreeFile.removePathIfPresent", { path: inputPath }),
    });
  },
  resolveWorktreePath(repoPath, worktreePath) {
    return path.isAbsolute(worktreePath) ? worktreePath : path.join(repoPath, worktreePath);
  },
  pathIsWithinRoot(root, candidate) {
    return Effect.gen(function* () {
      const normalizedRoot = yield* normalizeForComparison(root);
      const normalizedCandidate = yield* normalizeForComparison(candidate);
      return (
        normalizedCandidate === normalizedRoot ||
        normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
      );
    });
  },
});

export const WorktreeFilePortLive = Layer.sync(WorktreeFilePortTag, createWorktreeFileAdapter);
