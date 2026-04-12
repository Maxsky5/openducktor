import { findLastSessionMessage } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export const resolveActiveStreamingAssistantMessageId = (
  session: Pick<AgentSessionState, "sessionId" | "messages" | "status"> | null,
): string | null => {
  if (!session || session.status !== "running") {
    return null;
  }

  const lastMessage = findLastSessionMessage(session);
  if (!lastMessage || lastMessage.role !== "assistant") {
    return null;
  }

  const assistantMeta = lastMessage.meta?.kind === "assistant" ? lastMessage.meta : null;
  return assistantMeta?.isFinal === false ? lastMessage.id : null;
};
