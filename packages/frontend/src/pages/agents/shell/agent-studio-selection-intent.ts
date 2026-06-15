import type { AgentRole } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type AgentStudioSelectionIntent = {
  taskId: string;
  sessionIdentity: AgentSessionIdentity | null;
  role: AgentRole;
};

export const isSelectionIntentResolved = (params: {
  selectionIntent: AgentStudioSelectionIntent;
  taskIdParam: string;
  sessionKeyParam: string | null;
  roleFromQuery: AgentRole;
}): boolean => {
  const { selectionIntent, taskIdParam, sessionKeyParam, roleFromQuery } = params;
  if (selectionIntent.taskId !== taskIdParam || selectionIntent.role !== roleFromQuery) {
    return false;
  }

  return (
    (selectionIntent.sessionIdentity
      ? agentSessionIdentityKey(selectionIntent.sessionIdentity)
      : null) === sessionKeyParam
  );
};
