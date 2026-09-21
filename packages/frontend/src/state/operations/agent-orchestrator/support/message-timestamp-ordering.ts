import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { isSessionSystemPromptMessage } from "./session-prompt";

const timestampMs = (timestamp: string): number | null => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
};

export const messageTimestampMs = (message: Pick<AgentChatMessage, "timestamp">): number | null =>
  timestampMs(message.timestamp);

export const sessionMessageTimestampInsertionIndex = (
  messages: readonly AgentChatMessage[],
  message: AgentChatMessage,
): number => {
  const incomingMs = messageTimestampMs(message);
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
    const existingMs = messageTimestampMs(existing);
    if (existingMs !== null && existingMs > incomingMs) {
      return index;
    }
  }
  return messages.length;
};
