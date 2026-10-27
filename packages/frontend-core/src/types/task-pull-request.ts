import type { PullRequest } from "@openducktor/contracts";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { CloseTaskOptions } from "./task-close";

export type TaskPullRequestOperations = {
  detectingPullRequestTaskIds: ReadonlySet<string>;
  linkingMergedPullRequestTaskId: string | null;
  unlinkingPullRequestTaskIds: ReadonlySet<string>;
  pendingMergedPullRequest: PendingMergedPullRequest | null;
  syncPullRequests: (taskId: string) => Promise<void>;
  linkMergedPullRequest: (options: CloseTaskOptions) => Promise<void>;
  cancelLinkMergedPullRequest: () => void;
  unlinkPullRequest: (taskId: string) => Promise<void>;
};

export type PendingMergedPullRequest = {
  taskId: string;
  taskTitle: string | null;
  /** The task value that the cleanup choice starts from. Null follows the global setting. */
  taskRemoveWorktreeOnClose: TaskCard["removeWorktreeOnClose"];
  pullRequest: PullRequest;
};
