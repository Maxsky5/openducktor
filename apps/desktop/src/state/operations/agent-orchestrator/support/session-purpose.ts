import type { AgentSessionPurpose, AgentSessionState } from "@/types/agent-orchestrator";

export const DEFAULT_AGENT_SESSION_PURPOSE: AgentSessionPurpose = "primary";

export const resolveAgentSessionPurpose = (
  purpose: AgentSessionPurpose | undefined,
): AgentSessionPurpose => {
  return purpose ?? DEFAULT_AGENT_SESSION_PURPOSE;
};

export const isTranscriptAgentSession = (
  session: Pick<AgentSessionState, "purpose"> | null | undefined,
): boolean => {
  return resolveAgentSessionPurpose(session?.purpose) === "transcript";
};

export const shouldIncludeAgentSessionInActivity = (
  session: Pick<AgentSessionState, "purpose">,
): boolean => {
  return !isTranscriptAgentSession(session);
};
