import type { TaskWorkflow } from "@openducktor/workflows";

/** A task that the task store holds. Pass the task record when the code has read it. */
export type StoredTask = { readonly id: string };

/** Finds the task workflow of a stored task, and the task workflow of a new task. */
export type TaskWorkflowResolver = {
  /** The workflow that a stored task follows. */
  readonly forTask: (task: StoredTask) => TaskWorkflow;
  /** The workflow that a new task of the repository follows. */
  readonly forNewTask: (repoPath: string) => TaskWorkflow;
  /** The task workflows of the host. Settings and reads of many tasks cover each of them. */
  readonly workflows: readonly TaskWorkflow[];
};
