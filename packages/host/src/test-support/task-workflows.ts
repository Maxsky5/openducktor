import { agentRoleDefinitionSchema, type AgentRoleDefinition } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  BUILTIN_ROLES,
  resolveWorkspaceBoard,
  taskWorkflowDescriptor,
  type TaskWorkflow,
} from "@openducktor/workflows";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import {
  BUILTIN_TASK_ASSIGNMENT,
  createTaskWorkflowVersionCache,
} from "../application/tasks/task-workflows";
import { HostValidationError } from "../effect/host-errors";
import type { ReadWorkflowSettingsSource } from "../application/workspaces/task-workflow-settings";
import type {
  TaskWorkflowResolver,
  TaskWorkflowVersionCache,
  WorkspaceWorkflowPort,
} from "../ports/task-workflow-port";

/** Every task without a stored version follows the built-in task workflow. */
export const builtinTaskWorkflows: TaskWorkflowVersionCache = createTaskWorkflowVersionCache();

/** Every task follows the workflow, whatever its stored assignment. */
export const singleTaskWorkflow = (workflow: TaskWorkflow): TaskWorkflowVersionCache => ({
  forTask: () => workflow,
  forReference: (reference) => {
    if (
      reference.id !== workflow.reference.id ||
      reference.revision !== workflow.reference.revision
    )
      throw new Error(`Workflow "${reference.id}@${reference.revision}" is not registered.`);
    return workflow;
  },
  missing: () => [],
  cached: () => undefined,
  put: () => {},
  dropRole: () => {},
  dropWorkflow: () => {},
  noteTasks: () => {},
  forTaskId: () => workflow,
});

/** Every task follows the review task workflow of the tests. Its IDs differ from the built-in IDs. */
export const reviewTaskWorkflows = singleTaskWorkflow(createReviewTaskWorkflow());

/**
 * A workspace port where each workspace enables one workflow: the workflow of a new task of the
 * resolver. It reads no database.
 */
export const testWorkspaceWorkflows = (
  taskWorkflows: TaskWorkflowResolver,
  hostInstanceId = "test-host",
): WorkspaceWorkflowPort => {
  const workflow = taskWorkflows.forTask(BUILTIN_TASK_ASSIGNMENT);
  const roles: AgentRoleDefinition[] = [
    ...BUILTIN_ROLES,
    ...workflow.roles
      .filter(({ id }) => !BUILTIN_ROLES.some((role) => role.id === id))
      .map(({ writes: _writes, defaultArtifact: _defaultArtifact, ...role }) => role),
  ].map((role) => agentRoleDefinitionSchema.parse(role));
  return {
    context: () =>
      Effect.succeed({
        hostInstanceId,
        board: resolveWorkspaceBoard([{ workflow, latest: true }]),
        workflows: [{ ...workflow.reference }],
        newTaskWorkflows: [{ ...workflow.reference }],
        newTaskWorkflow: { ...workflow.reference },
      }),
    newTaskWorkflow: (_scope, workflowId) =>
      workflowId === undefined || workflowId === workflow.reference.id
        ? Effect.succeed(workflow)
        : Effect.fail(
            new HostValidationError({
              field: "workflowId",
              message: `Workflow "${workflowId}" is not available in this repository.`,
            }),
          ),
    catalog: () =>
      Effect.succeed({
        hostInstanceId,
        roles,
        workflows: [taskWorkflowDescriptor(workflow)],
      }),
    settingsOwners: () => Effect.succeed({ latest: [workflow], roles }),
    sessionTaskWorkflow: () => Effect.succeed(workflow),
  };
};

/** The workflow settings owners of a test resolver: its new task workflow and the built-in roles. */
export const testWorkflowSettings =
  (taskWorkflows: TaskWorkflowResolver = builtinTaskWorkflows): ReadWorkflowSettingsSource =>
  () =>
    testWorkspaceWorkflows(taskWorkflows).settingsOwners().pipe(Effect.orDie);

/** The workflow settings owners of the built-in workflow and roles. */
export const builtinWorkflowSettingsOwners = {
  latest: [builtinTaskWorkflows.forTask(BUILTIN_TASK_ASSIGNMENT)],
  roles: BUILTIN_ROLES.map((role) => agentRoleDefinitionSchema.parse(role)),
};
