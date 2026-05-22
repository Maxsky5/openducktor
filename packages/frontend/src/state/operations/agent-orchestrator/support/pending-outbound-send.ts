import type { AgentSessionState } from "@/types/agent-orchestrator";

type SessionWithPendingOutboundSend = AgentSessionState & {
  pendingUserMessageStartedAt: number;
  status: "running";
};

export const hasPendingOutboundSend = (
  session: AgentSessionState,
): session is SessionWithPendingOutboundSend => {
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

export const settlePendingOutboundSendFields = (): Pick<
  AgentSessionState,
  | "pendingUserMessageStartedAt"
  | "draftAssistantText"
  | "draftAssistantMessageId"
  | "draftReasoningText"
  | "draftReasoningMessageId"
> => ({
  pendingUserMessageStartedAt: undefined,
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
});
