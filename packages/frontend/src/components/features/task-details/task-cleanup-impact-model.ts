import type { TaskConfirmDialogState, TaskConfirmImpact } from "./task-confirm-dialog-types";

export const formatManagedSessionCleanupMessage = (managedWorktreeCount: number): string => {
  if (managedWorktreeCount > 0) {
    return `${managedWorktreeCount} linked task worktree${managedWorktreeCount === 1 ? "" : "s"} and their related local branches will also be deleted. Any uncommitted changes in those worktrees will be lost.`;
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

type ConfirmButtonState = { isBusy: boolean; disabled: boolean; label: string };

/** The Confirm button of a confirmation waits for the action and for its impact reads. */
export const confirmButtonState = (
  impact: TaskConfirmImpact,
  operation: TaskConfirmDialogState["operation"],
  labels: { idle: string; pending: string },
): ConfirmButtonState => {
  const isBusy = operation.isPending || impact.isLoading || impact.isLoadingStopImpact;
  let label = labels.idle;
  if (operation.isPending) label = labels.pending;
  else if (isBusy) label = "Checking...";
  return { isBusy, disabled: isBusy || impact.activeSessionCountError !== null, label };
};
