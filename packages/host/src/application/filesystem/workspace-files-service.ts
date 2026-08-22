import {
  type JsonValue,
  type WorkspaceFileGitStatus,
  type WorkspaceFileTree,
  type WorkspaceFileTreeEntry,
  type WorkspaceTextFileReadResult,
  type WorkspaceTextFileWriteResult,
  workspaceFileTreeSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { FilesystemPort, FilesystemStats } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import {
  canonicalizeWorkspaceRoot,
  loadWorkspaceFilePaths,
  workspaceFileValidationError,
} from "./workspace-file-access";
import { toWorkspaceRelativeGitPath } from "./workspace-files-paths";
import {
  createWorkspaceTextFileService,
  type WorkspaceTextFileWriteError,
} from "./workspace-text-file-service";

interface GITSTATUSPRIORITYContract extends Record<WorkspaceFileGitStatus, number> {}

export type WorkspaceFilesService = {
  listTree(input: {
    rootPath: string;
    targetBranch?: string;
  }): Effect.Effect<WorkspaceFileTree, HostValidationError>;
  readTextFile(input: {
    rootPath: string;
    relativePath: string;
  }): Effect.Effect<WorkspaceTextFileReadResult, HostValidationError>;
  writeTextFile(
    input: JsonValue | undefined,
  ): Effect.Effect<WorkspaceTextFileWriteResult, WorkspaceTextFileWriteError>;
};

const PIERRE_GIT_STATUSES = new Set<WorkspaceFileGitStatus>([
  "added",
  "deleted",
  "modified",
  "renamed",
  "untracked",
  "ignored",
]);

const compareWorkspacePaths = (left: string, right: string): number => {
  const insensitive = left.toLowerCase().localeCompare(right.toLowerCase());
  return insensitive === 0 ? left.localeCompare(right) : insensitive;
};

// SAFETY: The preceding runtime guard establishes `WorkspaceFileGitStatus` before this assertion.
const normalizeGitStatus = (
  status: string | null | undefined,
): Effect.Effect<WorkspaceFileGitStatus | null, HostValidationError> => {
  if (!status) {
    return Effect.succeed(null);
  }
  if (PIERRE_GIT_STATUSES.has(status as WorkspaceFileGitStatus)) {
    // SAFETY: The preceding runtime guard establishes `WorkspaceFileGitStatus` before this assertion.
    return Effect.succeed(status as WorkspaceFileGitStatus);
  }
  if (status === "copied") {
    return Effect.succeed("added");
  }
  if (status === "typechange" || status === "unmerged") {
    return Effect.succeed("modified");
  }
  return Effect.fail(
    new HostValidationError({
      field: "gitStatus",
      message: `Unrecognized Git status value: ${status}`,
      details: { status },
    }),
  );
};
const GIT_STATUS_PRIORITY: GITSTATUSPRIORITYContract = {
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

const projectGitChangeToWorkspace = (
  filesystem: FilesystemPort,
  repositoryRoot: string,
  workspaceRoot: string,
  change: { originalPath?: string; path: string; status: string },
): { path: string; status: string } | null => {
  const path = toWorkspaceRelativeGitPath(filesystem, repositoryRoot, workspaceRoot, change.path);
  if (path) {
    return { path, status: change.status };
  }
  if (change.status !== "renamed" || !change.originalPath) {
    return null;
  }
  const originalPath = toWorkspaceRelativeGitPath(
    filesystem,
    repositoryRoot,
    workspaceRoot,
    change.originalPath,
  );
  return originalPath ? { path: originalPath, status: "deleted" } : null;
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
  filesystem
    .stat(filesystem.join(canonicalRoot, relativePath), { followSymbolicLinks: false })
    .pipe(
      Effect.mapError((cause) =>
        workspaceFileValidationError(cause, `Unable to inspect file '${relativePath}'.`, {
          rootPath: canonicalRoot,
          relativePath,
        }),
      ),
    );

export const createWorkspaceFilesService = (
  filesystem: FilesystemPort,
  gitPort: GitPort,
): WorkspaceFilesService => {
  const textFiles = createWorkspaceTextFileService(filesystem, gitPort);
  return {
    listTree(input) {
      return Effect.gen(function* () {
        const canonicalRoot = yield* canonicalizeWorkspaceRoot(filesystem, input.rootPath);
        const listedFilePaths = yield* loadWorkspaceFilePaths(gitPort, canonicalRoot);
        const repositoryRoot = yield* gitPort.getRepositoryRoot(canonicalRoot).pipe(
          Effect.mapError((cause) =>
            workspaceFileValidationError(
              cause,
              `Unable to resolve Git repository root for '${canonicalRoot}'.`,
              {
                rootPath: canonicalRoot,
              },
            ),
          ),
        );
        const targetChanges = input.targetBranch
          ? yield* gitPort.listChangedFiles(canonicalRoot, input.targetBranch).pipe(
              Effect.mapError((cause) =>
                workspaceFileValidationError(
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
            workspaceFileValidationError(
              cause,
              `Unable to read Git status for '${canonicalRoot}'.`,
              {
                rootPath: canonicalRoot,
              },
            ),
          ),
        );
        const materializedFilePaths = new Set(listedFilePaths);
        const filePathSet = new Set(materializedFilePaths);
        const gitStatusByPath = new Map<string, WorkspaceFileGitStatus | null>();
        for (const change of targetChanges) {
          const workspaceChange = projectGitChangeToWorkspace(
            filesystem,
            repositoryRoot,
            canonicalRoot,
            change,
          );
          if (!workspaceChange) {
            continue;
          }
          const normalizedStatus = yield* normalizeGitStatus(workspaceChange.status);
          if (normalizedStatus !== "deleted" && !materializedFilePaths.has(workspaceChange.path)) {
            continue;
          }
          filePathSet.add(workspaceChange.path);
          gitStatusByPath.set(
            workspaceChange.path,
            mergeGitStatus(gitStatusByPath.get(workspaceChange.path), normalizedStatus),
          );
        }
        for (const status of statuses) {
          const workspaceChange = projectGitChangeToWorkspace(
            filesystem,
            repositoryRoot,
            canonicalRoot,
            status,
          );
          if (!workspaceChange) {
            continue;
          }
          const normalizedStatus = yield* normalizeGitStatus(workspaceChange.status);
          filePathSet.add(workspaceChange.path);
          gitStatusByPath.set(
            workspaceChange.path,
            mergeGitStatus(gitStatusByPath.get(workspaceChange.path), normalizedStatus),
          );
        }
        const filePaths = [...filePathSet].sort(compareWorkspacePaths);
        const directoryPaths = directoryPathsForFiles(filePaths);
        const directoryEntries = new Map<string, WorkspaceFileTreeEntry>(
          directoryPaths.map((directoryPath) => [
            directoryPath,
            {
              path: directoryPath,
              kind: "directory" as const,
              size: null,
              mtimeMs: null,
              gitStatus: null,
            },
          ]),
        );
        const fileEntries: WorkspaceFileTreeEntry[] = [];
        for (const filePath of filePaths) {
          const gitStatus = gitStatusByPath.get(filePath) ?? null;
          const metadataResult = yield* Effect.either(
            statFile(filesystem, canonicalRoot, filePath),
          );
          if (metadataResult._tag === "Left") {
            if (gitStatus !== "deleted") {
              return yield* Effect.fail(metadataResult.left);
            }
            fileEntries.push({
              path: filePath,
              kind: "file",
              size: null,
              mtimeMs: null,
              gitStatus,
            });
            continue;
          }
          const metadata = metadataResult.right;
          if (metadata.isDirectory) {
            const directoryPath = filePath.replace(/\/+$/u, "");
            directoryEntries.set(directoryPath, {
              path: directoryPath,
              kind: "directory",
              size: null,
              mtimeMs: null,
              gitStatus,
            });
            continue;
          }
          fileEntries.push({
            path: filePath,
            kind: "file",
            size: metadata.size ?? null,
            mtimeMs: metadata.mtimeMs ?? null,
            gitStatus,
          });
        }
        return workspaceFileTreeSchema.parse({
          rootPath: canonicalRoot,
          entries: [
            ...[...directoryEntries.values()].sort((left, right) =>
              compareWorkspacePaths(left.path, right.path),
            ),
            ...fileEntries,
          ],
        });
      });
    },
    readTextFile(input) {
      return textFiles.readTextFile(input);
    },
    writeTextFile(input) {
      return textFiles.writeTextFile(input);
    },
  };
};
