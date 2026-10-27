import type { TaskEventStatusChange } from "@openducktor/contracts";

/** Names the task mutation that published a task event or committed a status change. */
export type TaskMutationOperation =
  | "create-artifact"
  | "rename-artifact"
  | "replace-artifact"
  | "delete-artifact"
  | "agent-session-create"
  | "agent-session-delete"
  | "agent-session-update-model"
  | "apply-task-event"
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
  | "human-request-changes"
  | "link-merged-pull-request"
  | "link-pull-request"
  | "repo-pull-request-sync"
  | "reset-implementation"
  | "reset-task"
  | "save-workflow-artifact"
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
  /** The Autopilot signal of the workflow outcome behind the change. */
  signal?: string;
};

/**
 * Receives each status change when it commits, in commit order, while the mutation holds its
 * repository mutation gate. It must not fail, block, or wait.
 */
export type CommittedTaskStatusChangeObserver = (change: CommittedTaskStatusChange) => void;
