import type { WorkflowRolePolicyResolver } from "@openducktor/core";
import {
  BUILTIN_TASK_WORKFLOWS,
  SPEC_PLAN_BUILD_BOARD_LAYOUT,
  specPlanBuildWorkflow,
} from "@openducktor/workflows";
import { createTaskWorkflowResolver } from "../../application/tasks/task-workflows";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

/** Every task follows the Spec, Plan, Build workflow until tasks name their workflow. */
export const builtinTaskWorkflowResolver = createTaskWorkflowResolver({
  forTask: () => specPlanBuildWorkflow,
  forNewTask: () => specPlanBuildWorkflow,
  workflows: BUILTIN_TASK_WORKFLOWS,
  forWorkspace: () => ({ board: SPEC_PLAN_BUILD_BOARD_LAYOUT, workflows: BUILTIN_TASK_WORKFLOWS }),
});

/** The tools and workspace access of a role in the task workflow of the session task. */
export const workflowRolePolicies =
  (taskWorkflows: TaskWorkflowResolver): WorkflowRolePolicyResolver =>
  ({ taskId, role }) => {
    const workflowRole = taskWorkflows.forTask({ id: taskId }).role(role);
    return { tools: workflowRole.tools, readOnly: workflowRole.workspaceAccess === "read" };
  };
