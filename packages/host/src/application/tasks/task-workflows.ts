import type { WorkspaceRef, WorkflowBoardDefinition } from "@openducktor/contracts";
import {
  resolveWorkflowBoard,
  taskWorkflowDescriptor,
  validateWorkflowInventory,
  workflowReferenceKey,
  workflowRoleCatalog,
  type TaskWorkflow,
  type WorkflowBoardLayout,
} from "@openducktor/workflows";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

type TaskWorkflowSource = Pick<TaskWorkflowResolver, "workflows" | "forTask" | "forNewTask"> & {
  forWorkspace(scope: WorkspaceRef): {
    board: WorkflowBoardLayout;
    workflows: readonly TaskWorkflow[];
  };
};

/**
 * Owns inventory validation, exact lookup, and workspace membership for every host consumer. The
 * inventory is checked once, and each board layout is resolved once for its workflows.
 */
export const createTaskWorkflowResolver = (source: TaskWorkflowSource): TaskWorkflowResolver => {
  const workflows = Object.freeze([...source.workflows]);
  validateWorkflowInventory(workflows);
  const descriptors = Object.freeze(workflows.map(taskWorkflowDescriptor));
  const roles = Object.freeze(workflowRoleCatalog(workflows));
  const registeredWorkflows = new Set(workflows);
  const byReference = new Map(
    workflows.map((workflow) => [workflowReferenceKey(workflow.reference), workflow]),
  );
  const registered = (workflow: TaskWorkflow) => {
    if (!registeredWorkflows.has(workflow))
      throw new Error(
        `Workflow "${workflowReferenceKey(workflow.reference)}" is not registered. Fix the host inventory.`,
      );
    return workflow;
  };
  const boards = new WeakMap<
    WorkflowBoardLayout,
    { workflows: readonly TaskWorkflow[]; board: WorkflowBoardDefinition }
  >();
  const resolvedBoard = (layout: WorkflowBoardLayout, members: readonly TaskWorkflow[]) => {
    const cached = boards.get(layout);
    if (cached?.workflows === members) return cached.board;
    const board = resolveWorkflowBoard(layout, members);
    boards.set(layout, { workflows: members, board });
    return board;
  };
  return {
    workflows,
    catalog: (hostInstanceId) => ({
      hostInstanceId,
      roles: [...roles],
      workflows: [...descriptors],
    }),
    forTask: (task) => registered(source.forTask(task)),
    forNewTask: (repoPath) => registered(source.forNewTask(repoPath)),
    forReference: (reference) => {
      const workflow = byReference.get(workflowReferenceKey(reference));
      if (!workflow)
        throw new Error(
          `Committed workflow "${workflowReferenceKey(reference)}" is unavailable. Fix the host inventory.`,
        );
      return workflow;
    },
    forWorkspace: (scope) => {
      const workspace = source.forWorkspace(scope);
      workspace.workflows.forEach(registered);
      const newTaskWorkflow = registered(source.forNewTask(scope.repoPath));
      if (!workspace.workflows.includes(newTaskWorkflow))
        throw new Error(
          `Workspace "${scope.workspaceId}" does not include its new-task workflow. Fix the host inventory.`,
        );
      return {
        workflows: workspace.workflows,
        newTaskWorkflow,
        board: resolvedBoard(workspace.board, workspace.workflows),
      };
    },
  };
};
