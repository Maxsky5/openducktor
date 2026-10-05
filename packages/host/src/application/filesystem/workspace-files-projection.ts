import type {
  WorkspaceFileGitStatus,
  WorkspaceFileTree,
  WorkspaceFileTreeEntry,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { GitFileListEntry, GitFileStatus, GitChangedFile } from "../../ports/git-port";
import { toWorkspaceRelativeGitPath } from "./workspace-files-paths";
type GitChange = Pick<GitChangedFile, "originalPath" | "path" | "status">;

/** Build visible entries from Git paths and keep deleted paths needed by the comparison. */
export const buildWorkspaceTree = (
  filesystem: Pick<FilesystemPort, "join" | "relative">,
  repositoryRoot: string,
  canonicalRoot: string,
  listedFiles: GitFileListEntry[],
  statuses: GitFileStatus[],
  targetChanges: GitChangedFile[],
): Effect.Effect<WorkspaceFileTree, HostValidationError<{ status: string }>> =>
  Effect.gen(function* () {
    const listedEntries = new Map(listedFiles.map((entry) => [entry.path, entry]));
    const paths = new Set(listedEntries.keys());
    const gitStatuses = new Map<string, WorkspaceFileGitStatus | null>();
    const unstagedTypeChanges = new Set<string>();
    const unstagedDeletes = new Set<string>();
    for (const change of targetChanges) {
      const changeInRoot = workspaceChange(filesystem, repositoryRoot, canonicalRoot, change);
      if (!changeInRoot) {
        continue;
      }
      const status = yield* treeStatus(changeInRoot.status);
      if (status !== "deleted" && !listedEntries.has(changeInRoot.path)) {
        continue;
      }
      paths.add(changeInRoot.path);
      gitStatuses.set(
        changeInRoot.path,
        mergeGitStatus(gitStatuses.get(changeInRoot.path), status),
      );
    }
    for (const record of statuses) {
      const changeInRoot = workspaceChange(filesystem, repositoryRoot, canonicalRoot, record);
      if (!changeInRoot) {
        continue;
      }
      if (record.status === "typechange" && !record.staged) {
        unstagedTypeChanges.add(changeInRoot.path);
      }
      if (record.status === "deleted" && !record.staged) {
        unstagedDeletes.add(changeInRoot.path);
      }
      const status = yield* treeStatus(changeInRoot.status);
      paths.add(changeInRoot.path);
      gitStatuses.set(
        changeInRoot.path,
        mergeGitStatus(gitStatuses.get(changeInRoot.path), status),
      );
    }
    const listedKinds = new Map(
      [...listedEntries].map(([path, entry]) => [
        path,
        entry.worktreeKind ??
          (entry.kind === "directory" && unstagedTypeChanges.has(path) ? "file" : entry.kind),
      ]),
    );
    const filePaths = [...paths].sort(compareWorkspacePaths);
    const filePathsOnDisk = new Set<string>();
    for (const [filePath, kind] of listedKinds) {
      if (kind === "file" && !unstagedDeletes.has(filePath)) {
        filePathsOnDisk.add(filePath);
      }
    }
    // A file on disk hides old tracked children after a directory becomes a file.
    const visibleFilePaths = filePaths.filter(
      (filePath) => !hasAncestor(filePath, filePathsOnDisk),
    );
    const directoryPaths = parentDirectories(visibleFilePaths);
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
      const gitStatus = gitStatuses.get(filePath) ?? null;
      if (directoryEntries.has(filePath) || listedKinds.get(filePath) === "directory") {
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
    return {
      rootPath: canonicalRoot,
      entries: [
        ...[...directoryEntries.values()].sort((left, right) =>
          compareWorkspacePaths(left.path, right.path),
        ),
        ...fileEntries,
      ],
    };
  });

const PIERRE_GIT_STATUSES: ReadonlySet<string> = new Set([
  "added",
  "deleted",
  "modified",
  "renamed",
  "untracked",
  "ignored",
] satisfies readonly WorkspaceFileGitStatus[]);

const isTreeStatus = (status: string): status is WorkspaceFileGitStatus =>
  PIERRE_GIT_STATUSES.has(status);

export const compareWorkspacePaths = (left: string, right: string): number => {
  const insensitive = left.toLowerCase().localeCompare(right.toLowerCase());
  return insensitive === 0 ? left.localeCompare(right) : insensitive;
};

const treeStatus = (
  status: string | null | undefined,
): Effect.Effect<WorkspaceFileGitStatus | null, HostValidationError<{ status: string }>> => {
  if (!status) {
    return Effect.succeed(null);
  }
  if (isTreeStatus(status)) {
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

const workspaceChange = (
  filesystem: Pick<FilesystemPort, "join" | "relative">,
  repositoryRoot: string,
  workspaceRoot: string,
  change: GitChange,
): GitChange | null => {
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

const parentDirectories = (filePaths: readonly string[]): string[] => {
  const directories = new Set<string>();
  for (const filePath of filePaths) {
    const segments = filePath.split("/").filter(Boolean);
    for (let length = 1; length < segments.length; length += 1) {
      directories.add(segments.slice(0, length).join("/"));
    }
  }
  return [...directories].sort(compareWorkspacePaths);
};

const hasAncestor = (filePath: string, ancestors: ReadonlySet<string>): boolean => {
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
