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
