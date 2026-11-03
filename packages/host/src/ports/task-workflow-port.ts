import type {
  WorkspaceRef,
  WorkflowBoardDefinition,
  WorkflowReference,
  WorkflowCatalog,
} from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";

/** A task that the task store holds. Pass the task record when the code has read it. */
export type StoredTask = { readonly id: string };

/** The validated host workflow inventory and its task and workspace resolution. */
export type TaskWorkflowResolver = {
  /** The workflow that a stored task follows. */
  readonly forTask: (task: StoredTask) => TaskWorkflow;
  /** The workflow that a new task of the repository follows. */
  readonly forNewTask: (repoPath: string) => TaskWorkflow;
  /** The exact registered revision. No latest-revision substitution. */
  readonly forReference: (reference: WorkflowReference) => TaskWorkflow;
  readonly catalog: (hostInstanceId: string) => WorkflowCatalog;
  /** A validated board and its registered workflows, including the creation default. */
  readonly forWorkspace: (scope: WorkspaceRef) => {
    board: WorkflowBoardDefinition;
    workflows: readonly TaskWorkflow[];
    newTaskWorkflow: TaskWorkflow;
  };
  readonly workflows: readonly TaskWorkflow[];
};
