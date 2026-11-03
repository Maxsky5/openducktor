import type { TaskWorktreeOwners } from "@openducktor/contracts";
import type { TaskWorktreeOwnersRead } from "../queries/use-task-worktree-owners";

/** An owner read that found no other owner, unless a test overrides it. */
export const worktreeOwnersRead = (
  overrides: Partial<TaskWorktreeOwnersRead> = {},
): TaskWorktreeOwnersRead => ({
  owners: null,
  historyReadErrors: [],
  isLoading: false,
  error: null,
  retry: () => {},
  ...overrides,
});

/** The host answer of an owner read that found no other owner. */
export const noTaskWorktreeOwners: TaskWorktreeOwners = {
  owners: { checkoutWorkspaces: [], tasks: [], chats: [], historyChats: [] },
  historyReadErrors: [],
};
