import type {
  AgentSessionState,
  AgentTaskSessionBinding,
  WorkflowAgentSessionState,
} from "@/types/agent-orchestrator";

export const isWorkflowAgentSession = (
  session: AgentSessionState | null | undefined,
): session is WorkflowAgentSessionState => {
  return session?.sessionAssociation.kind === "workflow";
};

export const requireWorkflowAgentSession = (
  session: AgentSessionState,
  action: string,
): WorkflowAgentSessionState => {
  if (isWorkflowAgentSession(session)) {
    return session;
  }
  throw new Error(
    `Cannot ${action} for session '${session.externalSessionId}' because its association is ${session.sessionAssociation.kind}.`,
  );
};

export const toAgentTaskSessionBinding = (
  session: AgentSessionState | null | undefined,
): AgentTaskSessionBinding | null =>
  isWorkflowAgentSession(session)
    ? {
        taskId: session.sessionAssociation.taskId,
        role: session.sessionAssociation.role,
      }
    : null;
