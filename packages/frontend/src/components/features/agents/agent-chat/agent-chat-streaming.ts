import { findLastSessionMessageByRole } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export const resolveActiveStreamingAssistantMessageId = (
  session: Pick<AgentSessionState, "externalSessionId" | "messages" | "status"> | null,
): string | null => {
  if (!session || session.status !== "running") {
    return null;
  }

  const lastStreamingAssistantMessage = findLastSessionMessageByRole(
    session,
    "assistant",
    (message) => message.meta?.kind === "assistant" && message.meta.isFinal === false,
  );

  return lastStreamingAssistantMessage?.id ?? null;
};
