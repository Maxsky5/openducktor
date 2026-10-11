import type { TaskEventStatusChange } from "@openducktor/contracts";

/** Names the task mutation that published a task event or committed a status change. */
export type TaskMutationOperation =
  | "agent-session-create"
  | "agent-session-delete"
  | "agent-session-update-model"
  | "build-blocked"
  | "build-completed"
  | "build-resumed"
  | "build-start"
  | "close-task"
  | "complete-direct-merge"
  | "create-task"
  | "delete-task"
  | "detect-pull-request"
  | "direct-merge"
  | "human-approve"
  | "human-request-changes"
  | "link-merged-pull-request"
  | "link-pull-request"
  | "qa-approved"
  | "qa-rejected"
  | "repo-pull-request-sync"
  | "reset-implementation"
  | "reset-task"
  | "save-plan-document"
  | "save-spec-document"
  | "set-plan"
  | "set-spec"
  | "transition-task"
  | "unlink-pull-request"
  | "update-task"
  | "upsert-pull-request";

/** One status change that a task mutation committed. */
export type CommittedTaskStatusChange = {
  /** The mutation gate key of the mutation. */
  repoPath: string;
  operation: TaskMutationOperation;
  statusChange: TaskEventStatusChange;
};

/**
 * Receives each status change when it commits, in commit order, while the mutation holds its
 * repository mutation gate. It must not fail, block, or wait.
 */
export type CommittedTaskStatusChangeObserver = (change: CommittedTaskStatusChange) => void;
