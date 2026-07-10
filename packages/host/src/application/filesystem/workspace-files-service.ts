import {
  type WorkspaceFileGitStatus,
  type WorkspaceFileTree,
  type WorkspaceFileTreeEntry,
  type WorkspaceTextFileReadResult,
  workspaceFileTreeSchema,
  workspaceTextFileReadResultSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { FilesystemPort, FilesystemStats } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";

export type WorkspaceFilesService = {
  listTree(input: {
    rootPath: string;
    targetBranch?: string;
  }): Effect.Effect<WorkspaceFileTree, HostValidationError>;
  readTextFile(input: {
    rootPath: string;
    relativePath: string;
  }): Effect.Effect<WorkspaceTextFileReadResult, HostValidationError>;
};

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const PIERRE_GIT_STATUSES = new Set<WorkspaceFileGitStatus>([
  "added",
  "deleted",
  "modified",
  "renamed",
  "untracked",
  "ignored",
]);

const isAbsolutePathLike = (value: string): boolean =>
  value.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(value);

const compareWorkspacePaths = (left: string, right: string): number => {
  const insensitive = left.toLowerCase().localeCompare(right.toLowerCase());
  return insensitive === 0 ? left.localeCompare(right) : insensitive;
};

const toHostValidationError = (
  cause: unknown,
  message: string,
  details?: Record<string, unknown>,
): HostValidationError =>
  new HostValidationError({
    message,
    cause,
    ...(details ? { details } : {}),
  });

const requireRelativePath = (relativePath: string): Effect.Effect<string, HostValidationError> => {
  const trimmed = relativePath.trim();
  if (!trimmed) {
    return Effect.fail(
      new HostValidationError({
        field: "relativePath",
        message: "File path is required.",
      }),
    );
  }
  if (isAbsolutePathLike(trimmed)) {
    return Effect.fail(
      new HostValidationError({
        field: "relativePath",
        message: "File path must be relative to the selected workspace root.",
        details: { relativePath },
      }),
    );
  }
  return Effect.succeed(trimmed);
};

const canonicalizeRoot = (filesystem: FilesystemPort, rootPath: string) =>
  Effect.gen(function* () {
    const canonicalRoot = yield* filesystem.canonicalize(rootPath).pipe(
      Effect.mapError((cause) =>
        toHostValidationError(cause, `Unable to resolve workspace root '${rootPath}'.`, {
          rootPath,
        }),
      ),
    );
    const metadata = yield* filesystem.stat(canonicalRoot).pipe(
      Effect.mapError((cause) =>
        toHostValidationError(cause, `Unable to inspect workspace root '${canonicalRoot}'.`, {
          rootPath: canonicalRoot,
        }),
      ),
    );
    if (!metadata.isDirectory) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "rootPath",
          message: `Workspace root is not a directory: ${canonicalRoot}`,
          details: { rootPath: canonicalRoot },
        }),
      );
    }
    return canonicalRoot;
  });

const isContainedPath = (
  filesystem: FilesystemPort,
  canonicalRoot: string,
  canonicalCandidate: string,
): boolean => {
  const relative = filesystem.relative(canonicalRoot, canonicalCandidate);
  const firstSegment = relative.split(/[\\/]/, 1)[0];
  return relative === "" || (firstSegment !== ".." && !isAbsolutePathLike(relative));
};

const canonicalizeContainedFile = (
  filesystem: FilesystemPort,
  canonicalRoot: string,
  relativePath: string,
) =>
  Effect.gen(function* () {
    const requestedPath = filesystem.join(canonicalRoot, relativePath);
    const canonicalPath = yield* filesystem.canonicalize(requestedPath).pipe(
      Effect.mapError((cause) =>
        toHostValidationError(cause, `Unable to resolve file '${relativePath}'.`, {
          rootPath: canonicalRoot,
          relativePath,
        }),
      ),
    );
    if (!isContainedPath(filesystem, canonicalRoot, canonicalPath)) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "relativePath",
          message: `File '${relativePath}' is outside the selected workspace root.`,
          details: { rootPath: canonicalRoot, relativePath },
        }),
      );
    }
    return canonicalPath;
  });

const normalizeGitStatus = (status: string | null | undefined): WorkspaceFileGitStatus | null => {
  if (!status) {
    return null;
  }
  if (PIERRE_GIT_STATUSES.has(status as WorkspaceFileGitStatus)) {
    return status as WorkspaceFileGitStatus;
  }
  return "modified";
};
const GIT_STATUS_PRIORITY: Record<WorkspaceFileGitStatus, number> = {
  ignored: 0,
  modified: 1,
  untracked: 2,
  added: 3,
  renamed: 4,
  deleted: 5,
};

const mergeGitStatus = (
  current: WorkspaceFileGitStatus | null | undefined,
  candidate: WorkspaceFileGitStatus | null,
): WorkspaceFileGitStatus | null => {
  if (!current) {
    return candidate;
  }
  if (!candidate) {
    return current;
  }
  return GIT_STATUS_PRIORITY[candidate] > GIT_STATUS_PRIORITY[current] ? candidate : current;
};

const directoryPathsForFiles = (filePaths: readonly string[]): string[] => {
  const directories = new Set<string>();
  for (const filePath of filePaths) {
    const segments = filePath.split("/").filter(Boolean);
    for (let length = 1; length < segments.length; length += 1) {
      directories.add(segments.slice(0, length).join("/"));
    }
  }
  return [...directories].sort(compareWorkspacePaths);
};

const statFile = (
  filesystem: FilesystemPort,
  canonicalRoot: string,
  relativePath: string,
): Effect.Effect<FilesystemStats, HostValidationError> =>
  filesystem.stat(filesystem.join(canonicalRoot, relativePath)).pipe(
    Effect.mapError((cause) =>
      toHostValidationError(cause, `Unable to inspect file '${relativePath}'.`, {
        rootPath: canonicalRoot,
        relativePath,
      }),
    ),
  );

const isBinaryBytes = (bytes: Uint8Array): boolean => {
  const sampleLength = Math.min(bytes.byteLength, 8192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) {
      return true;
    }
  }
  return false;
};

export const createWorkspaceFilesService = (
  filesystem: FilesystemPort,
  gitPort: GitPort,
): WorkspaceFilesService => ({
  listTree(input) {
    return Effect.gen(function* () {
      const canonicalRoot = yield* canonicalizeRoot(filesystem, input.rootPath);
      const isGitRepository = yield* gitPort.isGitRepository(canonicalRoot).pipe(
        Effect.mapError((cause) =>
          toHostValidationError(cause, `Unable to inspect Git repository '${canonicalRoot}'.`, {
            rootPath: canonicalRoot,
          }),
        ),
      );
      if (!isGitRepository) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "rootPath",
            message: `File explorer requires a Git repository root: ${canonicalRoot}`,
            details: { rootPath: canonicalRoot },
          }),
        );
      }

      const listedFilePaths = yield* gitPort.listFiles(canonicalRoot).pipe(
        Effect.mapError((cause) =>
          toHostValidationError(cause, `Unable to list Git files for '${canonicalRoot}'.`, {
            rootPath: canonicalRoot,
          }),
        ),
      );
      const targetChanges = input.targetBranch
        ? yield* gitPort.listChangedFiles(canonicalRoot, input.targetBranch).pipe(
            Effect.mapError((cause) =>
              toHostValidationError(
                cause,
                `Unable to read Git diff for '${canonicalRoot}' against '${input.targetBranch}'.`,
                {
                  rootPath: canonicalRoot,
                  targetBranch: input.targetBranch,
                },
              ),
            ),
          )
        : [];
      const statuses = yield* gitPort.getStatus(canonicalRoot).pipe(
        Effect.mapError((cause) =>
          toHostValidationError(cause, `Unable to read Git status for '${canonicalRoot}'.`, {
            rootPath: canonicalRoot,
          }),
        ),
      );
      const filePathSet = new Set(listedFilePaths);
      const gitStatusByPath = new Map<string, WorkspaceFileGitStatus | null>();
      for (const change of targetChanges) {
        filePathSet.add(change.path);
        gitStatusByPath.set(
          change.path,
          mergeGitStatus(gitStatusByPath.get(change.path), normalizeGitStatus(change.status)),
        );
      }
      for (const status of statuses) {
        filePathSet.add(status.path);
        gitStatusByPath.set(
          status.path,
          mergeGitStatus(gitStatusByPath.get(status.path), normalizeGitStatus(status.status)),
        );
      }
      const filePaths = [...filePathSet].sort(compareWorkspacePaths);
      const directoryPaths = directoryPathsForFiles(filePaths);
      const entries: WorkspaceFileTreeEntry[] = [
        ...directoryPaths.map((directoryPath) => ({
          path: directoryPath,
          kind: "directory" as const,
          size: null,
          mtimeMs: null,
          gitStatus: null,
        })),
      ];
      for (const filePath of filePaths) {
        const gitStatus = gitStatusByPath.get(filePath) ?? null;
        const metadataResult = yield* Effect.either(statFile(filesystem, canonicalRoot, filePath));
        if (metadataResult._tag === "Left") {
          if (gitStatus !== "deleted") {
            return yield* Effect.fail(metadataResult.left);
          }
          entries.push({
            path: filePath,
            kind: "file",
            size: null,
            mtimeMs: null,
            gitStatus,
          });
          continue;
        }
        const metadata = metadataResult.right;
        entries.push({
          path: filePath,
          kind: "file",
          size: metadata.size ?? null,
          mtimeMs: metadata.mtimeMs ?? null,
          gitStatus,
        });
      }
      return workspaceFileTreeSchema.parse({
        rootPath: canonicalRoot,
        entries,
      });
    });
  },
  readTextFile(input) {
    return Effect.gen(function* () {
      const canonicalRoot = yield* canonicalizeRoot(filesystem, input.rootPath);
      const relativePath = yield* requireRelativePath(input.relativePath);
      const canonicalPath = yield* canonicalizeContainedFile(
        filesystem,
        canonicalRoot,
        relativePath,
      );
      const metadata = yield* filesystem.stat(canonicalPath).pipe(
        Effect.mapError((cause) =>
          toHostValidationError(cause, `Unable to inspect file '${relativePath}'.`, {
            rootPath: canonicalRoot,
            relativePath,
          }),
        ),
      );
      if (metadata.isDirectory || metadata.isFile === false) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "relativePath",
            message: `Selected path is not a file: ${relativePath}`,
            details: { rootPath: canonicalRoot, relativePath },
          }),
        );
      }
      const size = metadata.size ?? 0;
      if (size > MAX_TEXT_FILE_BYTES) {
        return workspaceTextFileReadResultSchema.parse({
          kind: "unsupported",
          rootPath: canonicalRoot,
          relativePath,
          reason: "too_large",
          message: `File is too large to preview (${size} bytes).`,
          size,
          mtimeMs: metadata.mtimeMs ?? null,
        });
      }
      const bytes = yield* filesystem.readFileBytes(canonicalPath, MAX_TEXT_FILE_BYTES + 1).pipe(
        Effect.mapError((cause) =>
          toHostValidationError(cause, `Unable to read file '${relativePath}'.`, {
            rootPath: canonicalRoot,
            relativePath,
          }),
        ),
      );
      const actualSize = Math.max(size, bytes.byteLength);
      if (bytes.byteLength > MAX_TEXT_FILE_BYTES) {
        return workspaceTextFileReadResultSchema.parse({
          kind: "unsupported",
          rootPath: canonicalRoot,
          relativePath,
          reason: "too_large",
          message: `File is too large to preview (${actualSize} bytes).`,
          size: actualSize,
          mtimeMs: metadata.mtimeMs ?? null,
        });
      }
      if (isBinaryBytes(bytes)) {
        return workspaceTextFileReadResultSchema.parse({
          kind: "unsupported",
          rootPath: canonicalRoot,
          relativePath,
          reason: "binary",
          message: "Binary files cannot be previewed as text.",
          size: actualSize,
          mtimeMs: metadata.mtimeMs ?? null,
        });
      }
      const contents = yield* Effect.try({
        try: () => TEXT_DECODER.decode(bytes),
        catch: (cause) =>
          toHostValidationError(cause, `File '${relativePath}' is not valid UTF-8 text.`, {
            rootPath: canonicalRoot,
            relativePath,
          }),
      });
      return workspaceTextFileReadResultSchema.parse({
        kind: "text",
        rootPath: canonicalRoot,
        relativePath,
        contents,
        size: actualSize,
        mtimeMs: metadata.mtimeMs ?? null,
      });
    });
  },
});
