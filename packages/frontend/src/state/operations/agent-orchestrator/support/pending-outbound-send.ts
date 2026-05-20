import type { AgentSessionHistoryMessage, AgentSessionPresenceSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { isFinalAssistantHistoryMessage } from "./history-finality";

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

export const shouldSettlePendingOutboundSendFromHydratedHistory = (
  session: AgentSessionState,
  history: AgentSessionHistoryMessage[],
  sessionPresence: AgentSessionPresenceSnapshot | null,
): boolean => {
  if (!hasPendingOutboundSend(session)) {
    return false;
  }
  if (sessionPresence?.presence !== "runtime" || sessionPresence.agentSessionStatus !== "idle") {
    return false;
  }

  const pendingUserMessageStartedAt = session.pendingUserMessageStartedAt;
  return history.some((message) => {
    if (!isFinalAssistantHistoryMessage(message)) {
      return false;
    }
    const completedAtMs = Date.parse(message.timestamp);
    return !Number.isNaN(completedAtMs) && completedAtMs >= pendingUserMessageStartedAt;
  });
};
