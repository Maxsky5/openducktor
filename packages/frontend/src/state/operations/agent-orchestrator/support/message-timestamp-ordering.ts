import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { isSessionSystemPromptMessage } from "./session-prompt";

const timestampMs = (timestamp: string): number | null => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
};

export const messageTimestampMs = (message: Pick<AgentChatMessage, "timestamp">): number | null =>
  timestampMs(message.timestamp);

/**
 * Timestamps already parsed for a message list. Callers that insert many
 * messages into the same list reuse the cache instead of re-parsing the list
 * on every insertion.
 */
export type MessageTimestampCache = {
  timestampsMs: readonly (number | null)[];
  minimumInsertionIndex: number;
};

export const sessionMessageTimestampInsertionIndex = (
  messages: readonly AgentChatMessage[],
  message: AgentChatMessage,
  cache?: MessageTimestampCache,
): number => {
  const incomingMs = messageTimestampMs(message);
  if (incomingMs === null) {
    return messages.length;
  }

  let minimumInsertionIndex = cache?.minimumInsertionIndex ?? 0;
  if (!cache) {
    for (let index = 0; index < messages.length; index += 1) {
      const existing = messages[index];
      if (existing && isSessionSystemPromptMessage(existing)) {
        minimumInsertionIndex = index + 1;
      }
    }
  }

  for (let index = minimumInsertionIndex; index < messages.length; index += 1) {
    const existing = messages[index];
    if (!cache && !existing) {
      continue;
    }
    const existingMs = cache ? cache.timestampsMs[index] : existing && messageTimestampMs(existing);
    if (existingMs !== null && existingMs !== undefined && existingMs > incomingMs) {
      return index;
    }
  }
  return messages.length;
};
