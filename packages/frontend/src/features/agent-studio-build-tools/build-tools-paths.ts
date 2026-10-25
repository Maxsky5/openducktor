import {
  isNonRepoWorktreePath,
  type TaskGitContextMode,
} from "@openducktor/frontend-core/git/task/task-worktree-paths";

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

export const resolveDirectBuildWorktreePath = ({
  repoPath,
  sessionWorkingDirectory,
}: {
  repoPath: string | null;
  sessionWorkingDirectory: string | null;
}): string | null =>
  isNonRepoWorktreePath(repoPath, sessionWorkingDirectory) ? sessionWorkingDirectory : null;

export const resolveBuildToolsOpenInTarget = ({
  contextMode,
  repoPath,
  worktreePath,
  queriedWorktreePath,
  sessionWorkingDirectory,
  isWorktreeResolving,
}: {
  contextMode: TaskGitContextMode;
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
    return { path: null, disabledReason: "Resolving task worktree path..." };
  }

  return {
    path: null,
    disabledReason: "Task worktree path is unavailable. Refresh the Git panel and try again.",
  };
};
