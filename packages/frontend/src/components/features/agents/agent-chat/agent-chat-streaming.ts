import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import { findLastSessionMessageByRole } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatThreadSession } from "./agent-chat.types";
import { isStreamingAssistantMessage } from "./agent-chat-thread-windowing";

export const resolveActiveStreamingAssistantMessageId = (
  session: Pick<AgentChatThreadSession, "activityState" | "externalSessionId" | "messages"> | null,
): string | null => {
  if (!isAgentSessionActivityWorking(session?.activityState)) {
    return null;
  }

  const lastStreamingAssistantMessage = findLastSessionMessageByRole(
    session,
    "assistant",
    isStreamingAssistantMessage,
  );

  return lastStreamingAssistantMessage?.id ?? null;
};
