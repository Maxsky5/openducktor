import type { AgentSessionScope } from "@openducktor/contracts";
import type { AgentRole } from "../types/agent-orchestrator";

export const formatWorkflowAgentSessionTitle = (role: AgentRole, taskId: string): string =>
  `${role.toUpperCase()} ${taskId}`;

/**
 * Returns the runtime session name for a scope.
 * A repository session name comes from the Workspace Session record.
 * When the scope has no name, the runtime session keeps its current name.
 */
export const formatAgentSessionTitle = (scope: AgentSessionScope): string | undefined => {
  if (scope.kind === "repository") {
    return scope.title;
  }
  return formatWorkflowAgentSessionTitle(scope.role, scope.taskId);
};
