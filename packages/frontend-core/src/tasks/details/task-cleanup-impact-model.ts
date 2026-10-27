import type { TerminalListResponse } from "@openducktor/contracts";
import type { TaskStopImpactState } from "../../queries/use-task-stop-impact";
import type { TaskConfirmDialogState, TaskConfirmImpact } from "./task-confirm-dialog-types";
import type { TaskCleanupImpact } from "./use-task-cleanup-impact";

/** The task terminals that a cleanup stops. */
export const runningTerminalCount = (response: TerminalListResponse | undefined): number =>
  response?.terminals.filter((terminal) => terminal.lifecycle !== "exited").length ?? 0;

export const formatManagedSessionCleanupMessage = (managedWorktreeCount: number): string => {
  if (managedWorktreeCount === 1) {
    return "1 linked task worktree and its related local branch will also be deleted. Any uncommitted changes in that worktree will be lost.";
  }
  if (managedWorktreeCount > 1) {
    return `${managedWorktreeCount} linked task worktrees and their related local branches will also be deleted. Any uncommitted changes in those worktrees will be lost.`;
  }

  return "Linked task worktrees and their related local branches will also be deleted if they exist. Any uncommitted changes in those worktrees will be lost.";
};

export const formatUnknownManagedSessionCleanupMessage = (): string =>
  "Linked task worktrees and their related local branches may also be deleted. Any uncommitted changes in those worktrees will be lost.";

const cleanupOperationLabels = {
  close: "closing",
  delete: "deletion",
  reset: "reset",
} as const;

export type TaskCleanupOperationLabel = keyof typeof cleanupOperationLabels;

export const formatManagedSessionCleanupLoadingMessage = (
  operation: TaskCleanupOperationLabel,
): string =>
  `Checking linked task worktree cleanup impact before ${cleanupOperationLabels[operation]}.`;

export const formatActiveSessionStopLoadingMessage = (
  operation: TaskCleanupOperationLabel,
): string => `Checking active agent sessions before ${cleanupOperationLabels[operation]}.`;

const activeSessionStopPhrases = {
  close: "before closing.",
  delete: "before deletion.",
  reset: "before the reset.",
} satisfies Record<TaskCleanupOperationLabel, string>;

export const formatActiveSessionStopMessage = (
  activeSessionCount: number,
  operation: TaskCleanupOperationLabel,
): string =>
  `${activeSessionCount} active agent session${activeSessionCount === 1 ? "" : "s"} will be stopped ${activeSessionStopPhrases[operation]}`;

/** What a confirmation says about worktree cleanup, or null when it knows of none. */
export const formatCleanupImpactMessage = (
  impact: Pick<
    TaskConfirmImpact,
    "isLoading" | "error" | "hasManagedSessionCleanup" | "managedWorktreeCount"
  >,
  operation: TaskCleanupOperationLabel,
): string | null => {
  if (impact.isLoading) return formatManagedSessionCleanupLoadingMessage(operation);
  if (impact.error) return formatUnknownManagedSessionCleanupMessage();
  if (impact.hasManagedSessionCleanup) {
    return formatManagedSessionCleanupMessage(impact.managedWorktreeCount);
  }
  return null;
};

/**
 * What a Close, Delete, or Reset Task confirmation shows. The host counts only the task worktrees
 * that still exist, so a worktree that Approve removed does not count. A host that omits the
 * count leaves the count of the session working directories.
 */
export const buildTaskConfirmImpact = (
  cleanup: TaskCleanupImpact,
  stop: TaskStopImpactState,
): TaskConfirmImpact => {
  const removedWorktreeCount = stop.removedWorktreeCount;
  return {
    // The worktree count comes with the stop impact, so the cleanup line waits for it too.
    isLoading: cleanup.isLoadingImpact || stop.isLoading,
    isLoadingStopImpact: stop.isLoading,
    hasManagedSessionCleanup:
      removedWorktreeCount === null ? cleanup.hasManagedSessionCleanup : removedWorktreeCount > 0,
    managedWorktreeCount: removedWorktreeCount ?? cleanup.managedWorktreeCount,
    terminalCount: cleanup.terminalCount,
    activeSessionCount: stop.stoppableSessionCount,
    activeSessionCountError: stop.error,
    error: cleanup.impactError,
  };
};

type ConfirmButtonState = { isBusy: boolean; disabled: boolean; label: string };

/** The Confirm button of a confirmation waits for the action and for its impact reads. */
export const confirmButtonState = (
  impact: TaskConfirmImpact,
  operation: TaskConfirmDialogState["operation"],
  labels: { idle: string; pending: string; checking: string },
): ConfirmButtonState => {
  const isBusy = operation.isPending || impact.isLoading || impact.isLoadingStopImpact;
  let label = labels.idle;
  if (operation.isPending) label = labels.pending;
  else if (isBusy) label = labels.checking;
  return { isBusy, disabled: isBusy || impact.activeSessionCountError !== null, label };
};
