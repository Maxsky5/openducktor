import type {
  AgentSessionState,
  AgentTaskSessionBinding,
  WorkflowAgentSessionState,
} from "@/types/agent-orchestrator";

export const isWorkflowAgentSession = (
  session: AgentSessionState | null | undefined,
): session is WorkflowAgentSessionState => {
  return Boolean(session && session.role !== null);
};

export const toAgentTaskSessionBinding = (
  session: AgentSessionState | null | undefined,
): AgentTaskSessionBinding | null =>
  isWorkflowAgentSession(session) ? { taskId: session.taskId, role: session.role } : null;
