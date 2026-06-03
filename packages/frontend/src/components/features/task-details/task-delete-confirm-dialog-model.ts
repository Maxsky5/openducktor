export const formatManagedSessionCleanupMessage = (managedWorktreeCount: number): string => {
  if (managedWorktreeCount > 0) {
    return `${managedWorktreeCount} linked task worktree${managedWorktreeCount === 1 ? "" : "s"} and their related local branches will also be deleted. Any uncommitted changes in those worktrees will be lost.`;
  }

  return "Linked task worktrees and their related local branches will also be deleted if they exist. Any uncommitted changes in those worktrees will be lost.";
};

export const formatUnknownManagedSessionCleanupMessage = (): string =>
  "Linked task worktrees and their related local branches may also be deleted. Any uncommitted changes in those worktrees will be lost.";

export const formatManagedSessionCleanupLoadingMessage = (): string =>
  "Checking linked task worktree cleanup impact before deletion.";
