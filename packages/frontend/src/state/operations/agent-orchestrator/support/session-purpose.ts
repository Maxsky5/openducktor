import type {
  AgentSessionPurpose,
  AgentSessionState,
  TranscriptAgentSessionState,
  WorkflowAgentSessionState,
} from "@/types/agent-orchestrator";

export const DEFAULT_AGENT_SESSION_PURPOSE: AgentSessionPurpose = "primary";

export const resolveAgentSessionPurpose = (
  purpose: AgentSessionPurpose | undefined,
): AgentSessionPurpose => {
  return purpose ?? DEFAULT_AGENT_SESSION_PURPOSE;
};

export const resolveAgentSessionPurposeForLoad = (input: {
  requestedSessionId?: string | null;
  sessionId: string;
  shouldHydrateRequestedSession: boolean;
  mode?: "bootstrap" | "requested_history" | "reconcile_live" | "recover_runtime_attachment";
}): AgentSessionPurpose => {
  return DEFAULT_AGENT_SESSION_PURPOSE;
};

export const isTranscriptAgentSession = (
  session: Pick<AgentSessionState, "purpose" | "role" | "scenario"> | null | undefined,
): session is TranscriptAgentSessionState => {
  return resolveAgentSessionPurpose(session?.purpose) === "transcript";
};

export const isWorkflowAgentSession = (
  session: AgentSessionState | null | undefined,
): session is WorkflowAgentSessionState => {
  if (!session) {
    return false;
  }

  return !isTranscriptAgentSession(session) && session.role !== null && session.scenario !== null;
};

export const shouldIncludeAgentSessionInActivity = (
  session: AgentSessionState,
): session is WorkflowAgentSessionState => {
  return isWorkflowAgentSession(session);
};
