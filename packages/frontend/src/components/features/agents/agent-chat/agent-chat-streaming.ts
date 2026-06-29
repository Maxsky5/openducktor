import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { findLastSessionMessageByRole } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "./agent-chat.types";

export const isAssistantMessageStreaming = (message: AgentChatMessage): boolean =>
  message.role === "assistant" &&
  message.meta?.kind === "assistant" &&
  message.meta.isFinal === false;

export const resolveActiveStreamingAssistantMessageId = (
  session: Pick<AgentChatThreadSession, "activityState" | "externalSessionId" | "messages"> | null,
): string | null => {
  if (!isAgentSessionActivityWorking(session?.activityState)) {
    return null;
  }

  const lastStreamingAssistantMessage = findLastSessionMessageByRole(
    session,
    "assistant",
    isAssistantMessageStreaming,
  );

  return lastStreamingAssistantMessage?.id ?? null;
};
