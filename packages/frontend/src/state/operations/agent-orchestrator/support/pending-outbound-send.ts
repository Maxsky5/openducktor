import type { AgentSessionState } from "@/types/agent-orchestrator";

export const hasPendingOutboundSend = (session: AgentSessionState): boolean => {
  return session.pendingUserMessageStartedAt !== undefined && session.status === "running";
};

export const shouldKeepPendingOutboundSendActiveOnIdle = (session: AgentSessionState): boolean => {
  return (
    hasPendingOutboundSend(session) &&
    session.draftAssistantText.trim().length === 0 &&
    session.draftReasoningText.trim().length === 0 &&
    session.pendingApprovals.length === 0 &&
    session.pendingQuestions.length === 0
  );
};
