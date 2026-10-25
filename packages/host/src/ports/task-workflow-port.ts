import type { TaskWorkflow } from "@openducktor/workflows";

/** Finds the task workflow of a repository. Every task of the repository follows it. */
export type TaskWorkflowResolver = {
  readonly forRepo: (repoPath: string) => TaskWorkflow;
  /** The task workflows of the host. Global settings cover each of them. */
  readonly workflows: readonly TaskWorkflow[];
};
