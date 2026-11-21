import { Effect } from "effect";
import { createSessionRolePolicies } from "../../application/agent-sessions/session-role-policies";
import type { PrepareRolePolicy } from "../../application/agent-sessions/task-session-operations";
import type { ReadWorkflowSettingsSource } from "../../application/workspaces/task-workflow-settings";
import { createTaskWorkflowVersionCache } from "../../application/tasks/task-workflows";
import { toHostOperationError } from "../../effect/host-errors";
import type {
  TaskWorkflowVersionCache,
  WorkspaceWorkflowPort,
} from "../../ports/task-workflow-port";

/**
 * The host wiring of task workflows: the role policy that each live session keeps from its start,
 * and the workflow owners of the settings.
 */
export const createNodeTaskWorkflowWiring = ({
  taskWorkflows,
  workspaceWorkflows,
}: {
  taskWorkflows: TaskWorkflowVersionCache;
  workspaceWorkflows: WorkspaceWorkflowPort;
}) => {
  const rolePolicies = createSessionRolePolicies(taskWorkflows.forTaskId);
  const prepareRolePolicy: PrepareRolePolicy = (scope) =>
    workspaceWorkflows.sessionTaskWorkflow(scope).pipe(
      Effect.mapError((cause) => toHostOperationError(cause, "session.role-policy")),
      Effect.flatMap((workflow) => rolePolicies.prepare(scope, workflow)),
    );
  const readWorkflowSettings: ReadWorkflowSettingsSource = () =>
    workspaceWorkflows
      .settingsOwners()
      .pipe(Effect.mapError((cause) => toHostOperationError(cause, "settings.workflow-owners")));
  return {
    resolveWorkflowRolePolicy: rolePolicies.resolve,
    prepareRolePolicy,
    readWorkflowSettings,
  };
};

export { createTaskWorkflowVersionCache };
