import { plural } from "../../lib/plural";
import { formatActiveSessionStopMessage } from "./task-cleanup-impact-model";
import type { TaskCloseImpact, TaskWorktreeImpact } from "./use-task-close-impact";

/** The fixed text of a task close and its cleanup choice. Every client shows the same text. */
export const TASK_CLOSE_COPY = {
  title: "Close task",
  description: "Move to Done and keep the task's history.",
  failureTitle: "Close failed",
  removeWorktreeLabel: "Remove worktree and branch",
  noCleanupTargets: "No task worktree or local branch remains.",
  changesLabel: "Changes",
  checkAgain: "Check again",
  retry: "Retry",
  /** What a close does not do, and what it keeps. */
  closeNotes: [
    "Keep artifacts, session history and the pull request link.",
    "Artifacts you added become read-only. Spec, plan and QA reports stay editable.",
    "Closing does not merge code or change a pull request.",
  ],
} as const;

/** The label of the Confirm control of a close. */
export const taskCloseConfirmLabel = (isPending: boolean): string =>
  isPending ? "Closing…" : "Close task";

/** The failed read of the global setting that the cleanup choice starts from. */
export const settingsReadErrorMessage = (error: string): string =>
  `Unable to read the settings: ${error}`;

/** The label of the worktrees or the branches that a cleanup removes. */
export const cleanupTargetLabel = (kind: "worktree" | "branch", count: number): string => {
  if (kind === "worktree") return count === 1 ? "Worktree" : "Worktrees";
  return count === 1 ? "Branch" : "Branches";
};

export const uncommittedFilesText = (count: number): string => plural(count, "uncommitted file");

/** The running terminals and sessions that a close stops. */
export const taskCloseEffectLines = (
  impact: Pick<TaskCloseImpact, "terminalCount" | "activeSessionCount">,
): string[] => {
  const lines: string[] = [];
  if (impact.terminalCount > 0) {
    lines.push(
      `${plural(impact.terminalCount, "task terminal")}, including action terminals, will be stopped.`,
    );
  }
  // A failed session read shows in the read error row, with a retry.
  if (impact.activeSessionCount) {
    lines.push(formatActiveSessionStopMessage(impact.activeSessionCount, "close"));
  }
  return lines;
};

/** The fixed text of the worktree removal of a closed task. */
export const TASK_REMOVE_WORKTREE_COPY = {
  title: "Remove worktree",
  failureTitle: "Remove failed",
  keepNote: "The task, its artifacts, session history and pull request link stay available.",
} as const;

export const taskRemoveWorktreeDescription = (taskId: string): string =>
  `Remove the worktree and the local task branch of ${taskId}. The task stays closed.`;

/** The label of the Confirm control of a worktree removal. */
export const taskRemoveWorktreeConfirmLabel = (isPending: boolean): string =>
  isPending ? "Removing…" : "Remove worktree";

/** What a worktree removal can lose and stops, then what it keeps. */
export const taskRemoveWorktreeEffectLines = (
  impact: Pick<TaskWorktreeImpact, "branchNames" | "terminalCount">,
): string[] => {
  const lines: string[] = [];
  // The removal force-deletes the branch. The Archive chat dialog warns the same way.
  if (impact.branchNames.length > 0) {
    lines.push("Commits that exist only on this branch may be lost.");
  }
  if (impact.terminalCount > 0) {
    lines.push(`${plural(impact.terminalCount, "task terminal")} will be stopped first.`);
  }
  lines.push(TASK_REMOVE_WORKTREE_COPY.keepNote);
  return lines;
};
