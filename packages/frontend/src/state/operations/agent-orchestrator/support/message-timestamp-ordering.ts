import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { isSessionSystemPromptMessage } from "./session-prompt";

const timestampMs = (timestamp: string): number | null => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
};

export const sessionMessageTimestampInsertionIndex = (
  messages: readonly AgentChatMessage[],
  message: AgentChatMessage,
): number => {
  const incomingMs = timestampMs(message.timestamp);
  if (incomingMs === null) {
    return messages.length;
  }

  let minimumInsertionIndex = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const existing = messages[index];
    if (existing && isSessionSystemPromptMessage(existing)) {
      minimumInsertionIndex = index + 1;
    }
  }

  for (let index = minimumInsertionIndex; index < messages.length; index += 1) {
    const existing = messages[index];
    if (!existing) {
      continue;
    }
    const existingMs = timestampMs(existing.timestamp);
    if (existingMs !== null && existingMs > incomingMs) {
      return index;
    }
  }
  return messages.length;
};
