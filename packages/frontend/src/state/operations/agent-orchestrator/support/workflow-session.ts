import type { AgentSessionState, WorkflowAgentSessionState } from "@/types/agent-orchestrator";

export const isWorkflowAgentSession = (
  session: AgentSessionState | null | undefined,
): session is WorkflowAgentSessionState => {
  return Boolean(session && session.role !== null);
};

export const shouldIncludeAgentSessionInActivity = (
  session: AgentSessionState,
): session is WorkflowAgentSessionState => {
  return isWorkflowAgentSession(session);
};
