import type { WorkflowRolePolicyResolver } from "@openducktor/core";
import { builtinTaskWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

/** Adds the lookup by workflow ID to the task workflows of a resolver. */
export const createTaskWorkflowResolver = (
  resolver: Omit<TaskWorkflowResolver, "forWorkflowId">,
): TaskWorkflowResolver => ({
  ...resolver,
  forWorkflowId: (workflowId) => {
    const workflow = resolver.workflows.find((value) => value.definition.id === workflowId);
    return workflow
      ? Effect.succeed(workflow)
      : Effect.fail(
          new HostValidationError({
            field: "workflowId",
            message: `Task workflow "${workflowId}" is not available on this host.`,
            details: { workflowId },
          }),
        );
  },
});

/** Every task follows the built-in task workflow until tasks name their workflow. */
export const builtinTaskWorkflowResolver = createTaskWorkflowResolver({
  forTask: () => builtinTaskWorkflow,
  forNewTask: () => builtinTaskWorkflow,
  workflows: [builtinTaskWorkflow],
});

/** The tools and workspace access of a role in the task workflow of the session task. */
export const workflowRolePolicies =
  (taskWorkflows: TaskWorkflowResolver): WorkflowRolePolicyResolver =>
  ({ taskId, role }) => {
    const workflowRole = taskWorkflows.forTask({ id: taskId }).role(role);
    return { tools: workflowRole.tools, readOnly: workflowRole.workspaceAccess === "read" };
  };
