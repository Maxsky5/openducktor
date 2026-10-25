import type { WorkflowRolePolicyResolver } from "@openducktor/core";
import { builtinTaskWorkflow } from "@openducktor/workflows";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

/** Every repository follows the built-in task workflow until tasks name their workflow. */
export const builtinTaskWorkflowResolver: TaskWorkflowResolver = {
  forRepo: () => builtinTaskWorkflow,
  workflows: [builtinTaskWorkflow],
};

/** The tools and workspace access of a role in the task workflow of the repository. */
export const workflowRolePolicies =
  (taskWorkflows: TaskWorkflowResolver): WorkflowRolePolicyResolver =>
  ({ repoPath, role }) => {
    const workflowRole = taskWorkflows.forRepo(repoPath).role(role);
    return { tools: workflowRole.tools, readOnly: workflowRole.workspaceAccess === "read" };
  };
