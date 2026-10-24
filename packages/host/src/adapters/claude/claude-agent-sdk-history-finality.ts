import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { MutableAssistantHistoryMessage } from "./claude-agent-sdk-history-assistant";
import { hasFinalStopStep } from "./claude-agent-sdk-history-support";

export const readClaudeHistoryAssistantTracking = (
  history: readonly AgentSessionHistoryMessage[],
) => {
  let lastAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantTextMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantText: string | undefined;
  let lastFinalAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastFinalAssistantText: string | undefined;
  for (const message of history) {
    if (message.role !== "assistant") continue;
    lastAssistantMessage = message;
    const messageText = message.text.trim();
    if (messageText.length === 0) continue;
    lastAssistantTextMessage = message;
    lastAssistantText = messageText;
    if (hasFinalStopStep(message)) {
      lastFinalAssistantMessage = message;
      lastFinalAssistantText = messageText;
    }
  }
  return {
    lastAssistantMessage,
    lastAssistantTextMessage,
    lastAssistantText,
    lastFinalAssistantMessage,
    lastFinalAssistantText,
  };
};
