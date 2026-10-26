import { normalizePathForComparison } from "@openducktor/path-support";
import { errorMessage } from "../../lib/errors";
import type { DiffDataState } from "../contracts";

/** Whether the Git and file views of a task read the repository root or the task worktree. */
export type TaskGitContextMode = "repository" | "worktree";

export type TaskWorktreeStatus = "idle" | "resolving" | "resolved" | "failed";

type QueriedBuildWorktreePathResult = {
  path: string | null;
  error: string | null;
};

/** True for a path that is set and is not the repository root, as a task worktree path is. */
export const isNonRepoWorktreePath = (repoPath: string | null, path: string | null): boolean => {
  if (!path || path.trim().length === 0) {
    return false;
  }

  const normalizedRepoPath = normalizePathForComparison(repoPath ?? "");
  return normalizedRepoPath.length === 0 || normalizePathForComparison(path) !== normalizedRepoPath;
};

const buildWorktreeResolutionError = (taskId: string, reason?: string): string => {
  const baseMessage = `Failed to resolve task worktree path for task ${taskId}`;
  const retryMessage = "Use Refresh to retry.";
  const normalizedReason = reason?.trim() ?? "";
  if (normalizedReason.length === 0) {
    return `${baseMessage}. ${retryMessage}`;
  }

  const reasonTerminator = /[.!?]$/.test(normalizedReason) ? "" : ".";
  return `${baseMessage}: ${normalizedReason}${reasonTerminator} ${retryMessage}`;
};

export const resolveQueriedBuildWorktreePath = ({
  repoPath,
  taskId,
  queriedWorkingDirectory,
}: {
  repoPath: string;
  taskId: string;
  queriedWorkingDirectory: string | null;
}): QueriedBuildWorktreePathResult => {
  // A task gets its worktree when its Builder starts, so a retry cannot help before that.
  if (!queriedWorkingDirectory || queriedWorkingDirectory.trim().length === 0) {
    return {
      path: null,
      error: `Task ${taskId} has no worktree yet. Start the Builder to create one.`,
    };
  }

  if (!isNonRepoWorktreePath(repoPath, queriedWorkingDirectory)) {
    return {
      path: null,
      error: buildWorktreeResolutionError(taskId, "Task worktree resolved to the repository root."),
    };
  }

  return { path: queriedWorkingDirectory, error: null };
};

export const buildQueryWorktreeError = (taskId: string, cause: unknown): string =>
  buildWorktreeResolutionError(taskId, errorMessage(cause));

/** The directory that the Files view of a task shows, or why it cannot show one. */
export type TaskFileExplorerRoot = {
  rootPath: string | null;
  unavailableReason: string | null;
};

export const resolveTaskExecutionFileExplorerRoot = ({
  workspaceRepoPath,
  contextMode,
  worktreePath,
  isWorktreeResolving,
  worktreeError,
}: {
  workspaceRepoPath: string | null;
  contextMode: TaskGitContextMode;
  worktreePath: string | null;
  isWorktreeResolving: boolean;
  worktreeError: string | null;
}): TaskFileExplorerRoot => {
  if (contextMode === "worktree") {
    if (worktreePath) {
      return { rootPath: worktreePath, unavailableReason: null };
    }
    if (isWorktreeResolving) {
      return { rootPath: null, unavailableReason: "Resolving task worktree..." };
    }
    return {
      rootPath: null,
      unavailableReason: worktreeError ?? "Task worktree is unavailable.",
    };
  }

  if (workspaceRepoPath) {
    return {
      rootPath: workspaceRepoPath,
      unavailableReason: null,
    };
  }

  return {
    rootPath: null,
    unavailableReason: "No repository is selected.",
  };
};

export const resolveTaskExecutionFileExplorerTargetBranch = ({
  contextMode,
  targetBranch,
  upstreamStatus,
  hasLoadedRepositoryStatus,
  targetBranchValidationError,
}: {
  contextMode: TaskGitContextMode;
  targetBranch: string | null;
  upstreamStatus: DiffDataState["upstreamStatus"];
  hasLoadedRepositoryStatus: boolean;
  targetBranchValidationError: string | null;
}): string | null => {
  if (contextMode === "worktree" && targetBranchValidationError) {
    return null;
  }
  if (contextMode === "repository") {
    if (!hasLoadedRepositoryStatus || upstreamStatus !== "tracking") {
      return null;
    }
  }
  return targetBranch;
};
