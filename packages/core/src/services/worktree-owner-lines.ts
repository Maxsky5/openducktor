import type { WorktreeOwners } from "@openducktor/contracts";

/** No other owner needs the worktrees. */
export const emptyWorktreeOwners = (): WorktreeOwners => ({
  checkoutWorkspaces: [],
  tasks: [],
  chats: [],
  historyChats: [],
});

/** One sentence about the others that need a removed worktree. A blocking line stops the cleanup. */
export type WorktreeOwnerLine = { text: string; blocking: boolean };

const chatTitles = (chats: WorktreeOwners["chats"]): string =>
  chats.map((chat) => `“${chat.title}”`).join(", ");

/**
 * Describes the others that need a worktree that a cleanup removes. Another workspace checkout,
 * another open task, and a saved chat that works there block the cleanup. A Claude chat whose
 * native history uses the worktree cannot resume after the removal. Its line only warns, because a
 * confirmation shows it. A caller without a confirmation decides itself to block on it.
 */
export const describeWorktreeOwners = (owners: WorktreeOwners): WorktreeOwnerLine[] => {
  const lines: WorktreeOwnerLine[] = [];
  if (owners.checkoutWorkspaces.length > 0)
    lines.push({
      text: `Workspaces use a removed worktree as their repository checkout: ${owners.checkoutWorkspaces.join(", ")}. Remove these workspaces first.`,
      blocking: true,
    });
  if (owners.tasks.length > 0)
    lines.push({
      text: `Open tasks use a removed worktree: ${owners.tasks.map((task) => `${task.title} (${task.taskId})`).join(", ")}. Close these tasks first.`,
      blocking: true,
    });
  if (owners.chats.length > 0)
    lines.push({
      text: `Saved sessions work in a removed worktree: ${chatTitles(owners.chats)}. Archive these sessions first.`,
      blocking: true,
    });
  if (owners.historyChats.length > 0)
    lines.push({
      text: `Saved Claude sessions keep their native history in a removed worktree: ${chatTitles(owners.historyChats)}. These sessions cannot resume after this.`,
      blocking: false,
    });
  return lines;
};
