import { errorMessage } from "@/lib/errors";

export type AgentStudioGitPanelContextMode = "repository" | "worktree";

export type BuildToolsWorktreeStatus = "idle" | "resolving" | "resolved" | "failed";

export type BuildToolsOpenInTarget = {
  path: string | null;
  disabledReason: string | null;
};

export const resolveBuildToolsSelectedTaskId = ({
  viewTaskId,
  viewSelectedTaskId,
}: {
  viewTaskId: string;
  viewSelectedTaskId: string | null;
}): string | null => {
  const hydratedTaskId = viewSelectedTaskId?.trim() ? viewSelectedTaskId : null;
  if (hydratedTaskId) {
    return hydratedTaskId;
  }

  return viewTaskId.trim().length > 0 ? viewTaskId : null;
};

export const isNonRepoWorktreePath = (repoPath: string | null, path: string | null): boolean => {
  if (!path || path.trim().length === 0) {
    return false;
  }

  return repoPath == null || repoPath.trim().length === 0 || path !== repoPath;
};

export const resolveDirectBuildWorktreePath = ({
  repoPath,
  sessionWorkingDirectory,
}: {
  repoPath: string | null;
  sessionWorkingDirectory: string | null;
}): string | null =>
  isNonRepoWorktreePath(repoPath, sessionWorkingDirectory) ? sessionWorkingDirectory : null;

export const buildWorktreeResolutionError = (taskId: string, reason?: string): string => {
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
}): { path: string | null; error: string | null } => {
  if (!queriedWorkingDirectory || queriedWorkingDirectory.trim().length === 0) {
    return {
      path: null,
      error: buildWorktreeResolutionError(taskId, "Task worktree is not available."),
    };
  }

  if (queriedWorkingDirectory === repoPath) {
    return {
      path: null,
      error: buildWorktreeResolutionError(taskId, "Task worktree resolved to the repository root."),
    };
  }

  return { path: queriedWorkingDirectory, error: null };
};

export const buildQueryWorktreeError = (taskId: string, cause: unknown): string =>
  buildWorktreeResolutionError(taskId, errorMessage(cause));

export const resolveBuildToolsOpenInTarget = ({
  contextMode,
  repoPath,
  worktreePath,
  queriedWorktreePath,
  sessionWorkingDirectory,
  isWorktreeResolving,
}: {
  contextMode: AgentStudioGitPanelContextMode;
  repoPath: string | null;
  worktreePath: string | null;
  queriedWorktreePath: string | null;
  sessionWorkingDirectory: string | null;
  isWorktreeResolving: boolean;
}): BuildToolsOpenInTarget => {
  if (contextMode === "repository") {
    if (repoPath && repoPath.trim().length > 0) {
      return { path: repoPath, disabledReason: null };
    }

    return {
      path: null,
      disabledReason: "Repository path is unavailable. Select a repository and try again.",
    };
  }

  for (const candidate of [worktreePath, queriedWorktreePath, sessionWorkingDirectory]) {
    if (isNonRepoWorktreePath(repoPath, candidate)) {
      return { path: candidate, disabledReason: null };
    }
  }

  if (isWorktreeResolving) {
    return { path: null, disabledReason: "Resolving builder worktree path..." };
  }

  return {
    path: null,
    disabledReason: "Builder worktree path is unavailable. Refresh the Git panel and try again.",
  };
};
