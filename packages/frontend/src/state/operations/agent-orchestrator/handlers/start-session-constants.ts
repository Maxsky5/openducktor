import type { TaskWorktreeSummary } from "@openducktor/contracts";
import { MISSING_BUILD_TARGET_ERROR } from "@/lib/session-start-errors";

export const STALE_START_ERROR = "Workspace changed while starting session.";

export const requireBuildContinuationTarget = (
  continuationTarget: TaskWorktreeSummary | null,
): TaskWorktreeSummary => {
  if (!continuationTarget) {
    throw new Error(MISSING_BUILD_TARGET_ERROR);
  }
  return continuationTarget;
};
