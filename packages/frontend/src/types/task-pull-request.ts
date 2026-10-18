import type { PullRequest } from "@openducktor/contracts";

export type TaskPullRequestOperations = {
  detectingPullRequestTaskIds: ReadonlySet<string>;
  linkingMergedPullRequestTaskId: string | null;
  unlinkingPullRequestTaskIds: ReadonlySet<string>;
  pendingMergedPullRequest: PendingMergedPullRequest | null;
  syncPullRequests: (taskId: string) => Promise<void>;
  linkMergedPullRequest: () => Promise<void>;
  cancelLinkMergedPullRequest: () => void;
  unlinkPullRequest: (taskId: string) => Promise<void>;
};

export type PendingMergedPullRequest = {
  taskId: string;
  taskTitle: string | null;
  pullRequest: PullRequest;
};
