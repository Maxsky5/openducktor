import type { AgentSessionScope } from "@openducktor/contracts";
import type { AgentRole } from "../types/agent-orchestrator";

export const formatWorkflowAgentSessionTitle = (role: AgentRole, taskId: string): string =>
  `${role.toUpperCase()} ${taskId}`;

/**
 * The runtime session title for a scope.
 * A repository scope carries the title from its Workspace Session record.
 * A scope without a title leaves the runtime session title unchanged.
 */
export const agentSessionTitle = (scope: AgentSessionScope): string | undefined => {
  if (scope.kind === "repository") {
    return scope.title;
  }
  return formatWorkflowAgentSessionTitle(scope.role, scope.taskId);
};

/**
 * Returns the value with the runtime session title for a scope.
 * A scope without a title returns the value unchanged.
 */
export const withAgentSessionTitle = <Value extends object>(
  value: Value,
  scope: AgentSessionScope,
): Value & { title?: string } => {
  const title = agentSessionTitle(scope);
  return title === undefined ? value : { ...value, title };
};
