import type {
  AgentSessionPurpose,
  AgentSessionState,
  TranscriptAgentSessionState,
  WorkflowAgentSessionState,
} from "@/types/agent-orchestrator";

const DEFAULT_AGENT_SESSION_PURPOSE: AgentSessionPurpose = "primary";

const resolveAgentSessionPurpose = (
  purpose: AgentSessionPurpose | undefined,
): AgentSessionPurpose => {
  return purpose ?? DEFAULT_AGENT_SESSION_PURPOSE;
};

export const isTranscriptAgentSession = (
  session: Pick<AgentSessionState, "purpose"> | null | undefined,
): session is TranscriptAgentSessionState => {
  return resolveAgentSessionPurpose(session?.purpose) === "transcript";
};

export const isWorkflowAgentSession = (
  session: AgentSessionState | null | undefined,
): session is WorkflowAgentSessionState => {
  if (!session) {
    return false;
  }

  return !isTranscriptAgentSession(session) && session.role !== null;
};

export const shouldIncludeAgentSessionInActivity = (
  session: AgentSessionState,
): session is WorkflowAgentSessionState => {
  return isWorkflowAgentSession(session);
};
