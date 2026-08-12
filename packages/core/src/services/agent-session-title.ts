import type { AgentSessionScope } from "@openducktor/contracts";
import type { AgentRole } from "../types/agent-orchestrator";

export const AGENT_REPOSITORY_SESSION_TITLE = "Repository session";

export const formatWorkflowAgentSessionTitle = (role: AgentRole, taskId: string): string =>
  `${role.toUpperCase()} ${taskId}`;

export const formatAgentSessionTitle = (scope: AgentSessionScope): string => {
  if (scope.kind === "repository") {
    return AGENT_REPOSITORY_SESSION_TITLE;
  }
  return formatWorkflowAgentSessionTitle(scope.role, scope.taskId);
};

export const agentSessionScopesEqual = (
  left: AgentSessionScope,
  right: AgentSessionScope,
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "repository") {
    return true;
  }
  return right.kind === "workflow" && left.taskId === right.taskId && left.role === right.role;
};

export const describeAgentSessionScope = (scope: AgentSessionScope): string => {
  if (scope.kind === "repository") {
    return "repository scope";
  }
  return `workflow scope for task '${scope.taskId}' and role '${scope.role}'`;
};
