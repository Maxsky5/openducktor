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
