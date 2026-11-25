import { useQuery } from "@tanstack/react-query";
import type { ResolvedTaskCard, TaskWorkflow } from "@openducktor/workflows";
import type { WorkspaceRef } from "@openducktor/contracts";
import { optionalWorkspaceWorkflowQueryOptions, type WorkspaceWorkflows } from "./workflows";

const NO_WORKFLOWS: readonly TaskWorkflow[] = [];

/** The workflows of the task form from the workspace read, without the read state. */
type FormWorkflows = {
  readonly taskWorkflow: TaskWorkflow | undefined;
  readonly workflowChoices: readonly TaskWorkflow[];
  readonly defaultWorkflow: TaskWorkflow | undefined;
  readonly selectionError: string | null;
};

/**
 * The workflow of a new task: the selected one among the enabled workflows, or the default one
 * without a selection. A picked workflow that the workspace no longer enables is no choice: the
 * form asks for another one, and never creates the task with the default workflow instead.
 */
const newTaskWorkflows = (
  workspace: WorkspaceWorkflows | undefined,
  selectedWorkflowId: string | null,
): FormWorkflows => {
  const workflowChoices = workspace?.newTaskWorkflows ?? NO_WORKFLOWS;
  const taskWorkflow =
    selectedWorkflowId === null
      ? workspace?.newTaskWorkflow
      : workflowChoices.find(({ reference }) => reference.id === selectedWorkflowId);
  const unavailable = workspace !== undefined && selectedWorkflowId !== null && !taskWorkflow;
  return {
    taskWorkflow,
    workflowChoices,
    defaultWorkflow: workspace?.newTaskWorkflow,
    selectionError: unavailable
      ? `Workflow "${selectedWorkflowId}" is no longer enabled in this workspace. Pick another workflow.`
      : null,
  };
};

/**
 * Editing uses the workflow of the task. Creation uses the workflow that the form selected among
 * the enabled workflows of the workspace, or the default workflow when the form selected none.
 * A selected workflow that the workspace no longer enables gives `selectionError`.
 */
export function useTaskFormWorkflow(
  task: ResolvedTaskCard | null,
  scope: WorkspaceRef | null,
  open: boolean,
  selectedWorkflowId: string | null = null,
) {
  const workspace = useQuery({
    ...optionalWorkspaceWorkflowQueryOptions(scope),
    enabled: open && task === null && scope !== null,
  });
  const workflows: FormWorkflows = task
    ? {
        taskWorkflow: task.taskWorkflow,
        workflowChoices: NO_WORKFLOWS,
        defaultWorkflow: undefined,
        selectionError: null,
      }
    : newTaskWorkflows(workspace.data, selectedWorkflowId);
  const error =
    (task ? null : workspace.error?.message) ??
    (!scope ? "Select the task workspace before editing." : null);
  return {
    ...workflows,
    error,
    pending: !error && !workflows.selectionError && !workflows.taskWorkflow,
    retry: async () => {
      if (!task) await workspace.refetch();
    },
  };
}
