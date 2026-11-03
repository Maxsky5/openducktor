import type { WorkflowRolePolicyResolver } from "@openducktor/core";
import { builtinTaskWorkflow, BUILTIN_BOARD_LAYOUT } from "@openducktor/workflows";
import { createTaskWorkflowResolver } from "../../application/tasks/task-workflows";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

const BUILTIN_WORKFLOWS = [builtinTaskWorkflow];

/** Every task follows the built-in task workflow until tasks name their workflow. */
export const builtinTaskWorkflowResolver = createTaskWorkflowResolver({
  forTask: () => builtinTaskWorkflow,
  forNewTask: () => builtinTaskWorkflow,
  workflows: BUILTIN_WORKFLOWS,
  forWorkspace: () => ({ board: BUILTIN_BOARD_LAYOUT, workflows: BUILTIN_WORKFLOWS }),
});

/** The tools and workspace access of a role in the task workflow of the session task. */
export const workflowRolePolicies =
  (taskWorkflows: TaskWorkflowResolver): WorkflowRolePolicyResolver =>
  ({ taskId, role }) => {
    const workflowRole = taskWorkflows.forTask({ id: taskId }).role(role);
    return { tools: workflowRole.tools, readOnly: workflowRole.workspaceAccess === "read" };
  };
