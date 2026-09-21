import {
  type WorkspaceFileGitStatus,
  type WorkspaceFileTree,
  type WorkspaceFileTreeEntry,
  type WorkspaceTextFileReadResult,
  type WorkspaceTextFileWriteInput,
  type WorkspaceTextFileWriteResult,
  workspaceFileTreeSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError, type HostValidationErrorAggregate } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import {
  canonicalizeWorkspaceRoot,
  loadWorkspaceFileEntries,
  workspaceFileValidationError,
} from "./workspace-file-access";
import { toWorkspaceRelativeGitPath } from "./workspace-files-paths";
import {
  createWorkspaceTextFileService,
  type WorkspaceTextFileWriteError,
} from "./workspace-text-file-service";

export type WorkspaceFilesService = {
  listTree(input: {
    rootPath: string;
    targetBranch?: string;
  }): Effect.Effect<WorkspaceFileTree, HostValidationErrorAggregate>;
  readTextFile(input: {
    rootPath: string;
    relativePath: string;
  }): Effect.Effect<WorkspaceTextFileReadResult, HostValidationErrorAggregate>;
  writeTextFile(
    input: WorkspaceTextFileWriteInput,
  ): Effect.Effect<WorkspaceTextFileWriteResult, WorkspaceTextFileWriteError>;
};

type WorkspaceGitChange = {
  originalPath?: string;
  path: string;
  status: string;
};

type ProjectedWorkspaceGitChange = {
  path: string;
  status: string;
};

const PIERRE_GIT_STATUSES: ReadonlySet<string> = new Set([
  "added",
  "deleted",
  "modified",
  "renamed",
  "untracked",
  "ignored",
] satisfies readonly WorkspaceFileGitStatus[]);

const isWorkspaceFileGitStatus = (status: string): status is WorkspaceFileGitStatus =>
  PIERRE_GIT_STATUSES.has(status);

const compareWorkspacePaths = (left: string, right: string): number => {
  const insensitive = left.toLowerCase().localeCompare(right.toLowerCase());
  return insensitive === 0 ? left.localeCompare(right) : insensitive;
};

const normalizeGitStatus = (
  status: string | null | undefined,
): Effect.Effect<WorkspaceFileGitStatus | null, HostValidationError<{ status: string }>> => {
  if (!status) {
    return Effect.succeed(null);
  }
  if (isWorkspaceFileGitStatus(status)) {
    return Effect.succeed(status);
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
const GIT_STATUS_PRIORITY = {
  ignored: 0,
  modified: 1,
  untracked: 2,
  added: 3,
  renamed: 4,
  deleted: 5,
} satisfies Record<WorkspaceFileGitStatus, number>;

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
  change: WorkspaceGitChange,
): ProjectedWorkspaceGitChange | null => {
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

const hasPathAncestor = (filePath: string, ancestors: ReadonlySet<string>): boolean => {
  for (
    let separator = filePath.indexOf("/");
    separator !== -1;
    separator = filePath.indexOf("/", separator + 1)
  ) {
    if (ancestors.has(filePath.slice(0, separator))) {
      return true;
    }
  }
  return false;
};

export const createWorkspaceFilesService = (
  filesystem: FilesystemPort,
  gitPort: Pick<
    GitPort,
    "getRepositoryRoot" | "getStatus" | "isGitRepository" | "listChangedFiles" | "listFiles"
  >,
): WorkspaceFilesService => {
  const textFiles = createWorkspaceTextFileService(filesystem, gitPort);
  return {
    listTree(input) {
      return Effect.gen(function* () {
        const canonicalRoot = yield* canonicalizeWorkspaceRoot(filesystem, input.rootPath);
        const listedFiles = yield* loadWorkspaceFileEntries(gitPort, canonicalRoot);
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
        const listedEntryByPath = new Map(listedFiles.map((entry) => [entry.path, entry]));
        const materializedFilePaths = new Set(listedEntryByPath.keys());
        const filePathSet = new Set(materializedFilePaths);
        const gitStatusByPath = new Map<string, WorkspaceFileGitStatus | null>();
        const unstagedTypechangePaths = new Set<string>();
        const unstagedDeletedPaths = new Set<string>();
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
          if (status.status === "typechange" && !status.staged) {
            unstagedTypechangePaths.add(workspaceChange.path);
          }
          if (status.status === "deleted" && !status.staged) {
            unstagedDeletedPaths.add(workspaceChange.path);
          }
          const normalizedStatus = yield* normalizeGitStatus(workspaceChange.status);
          filePathSet.add(workspaceChange.path);
          gitStatusByPath.set(
            workspaceChange.path,
            mergeGitStatus(gitStatusByPath.get(workspaceChange.path), normalizedStatus),
          );
        }
        const listedKindByPath = new Map(
          [...listedEntryByPath].map(([path, entry]) => [
            path,
            entry.worktreeKind ??
              (entry.kind === "directory" && unstagedTypechangePaths.has(path)
                ? "file"
                : entry.kind),
          ]),
        );
        const filePaths = [...filePathSet].sort(compareWorkspacePaths);
        const materializedRegularFilePaths = new Set<string>();
        for (const [filePath, kind] of listedKindByPath) {
          if (kind === "file" && !unstagedDeletedPaths.has(filePath)) {
            materializedRegularFilePaths.add(filePath);
          }
        }
        const visibleFilePaths = filePaths.filter(
          (filePath) => !hasPathAncestor(filePath, materializedRegularFilePaths),
        );
        const directoryPaths = directoryPathsForFiles(visibleFilePaths);
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
        for (const filePath of visibleFilePaths) {
          const gitStatus = gitStatusByPath.get(filePath) ?? null;
          if (directoryEntries.has(filePath)) {
            directoryEntries.set(filePath, {
              path: filePath,
              kind: "directory",
              size: null,
              mtimeMs: null,
              gitStatus,
            });
            continue;
          }
          if (listedKindByPath.get(filePath) === "directory") {
            directoryEntries.set(filePath, {
              path: filePath,
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
            size: null,
            mtimeMs: null,
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
