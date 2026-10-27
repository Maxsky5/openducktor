import type { WorkflowRolePolicyResolver } from "@openducktor/core";
import { builtinTaskWorkflow } from "@openducktor/workflows";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

/** Every task follows the built-in task workflow until tasks name their workflow. */
export const builtinTaskWorkflowResolver: TaskWorkflowResolver = {
  forTask: () => builtinTaskWorkflow,
  forNewTask: () => builtinTaskWorkflow,
  workflows: [builtinTaskWorkflow],
};

/** The tools and workspace access of a role in the task workflow of the session task. */
export const workflowRolePolicies =
  (taskWorkflows: TaskWorkflowResolver): WorkflowRolePolicyResolver =>
  ({ taskId, role }) => {
    const workflowRole = taskWorkflows.forTask({ id: taskId }).role(role);
    return { tools: workflowRole.tools, readOnly: workflowRole.workspaceAccess === "read" };
  };
