import type { AgentSessionState, WorkflowAgentSessionState } from "@/types/agent-orchestrator";

export const isWorkflowAgentSession = (
  session: AgentSessionState | null | undefined,
): session is WorkflowAgentSessionState => {
  return Boolean(session && session.role !== null);
};
