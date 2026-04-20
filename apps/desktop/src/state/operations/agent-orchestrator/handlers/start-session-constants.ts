import type { TaskWorktreeSummary } from "@openducktor/contracts";

export const STALE_START_ERROR = "Workspace changed while starting session.";

export const MISSING_BUILD_TARGET_ERROR =
  "Builder continuation cannot start until a builder worktree exists";

export const requireBuildContinuationTarget = (
  continuationTarget: TaskWorktreeSummary | null,
): TaskWorktreeSummary => {
  if (!continuationTarget) {
    throw new Error(MISSING_BUILD_TARGET_ERROR);
  }
  return continuationTarget;
};
