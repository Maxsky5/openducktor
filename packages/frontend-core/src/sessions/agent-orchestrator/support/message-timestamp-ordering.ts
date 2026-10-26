import type { AgentChatMessage } from "../../../types/agent-orchestrator";
import { isSessionSystemPromptMessage } from "./session-prompt";

// History merges and turn timing read the time of each message many times, and a message never
// changes its time, so each message parses its time once.
const timestampsMs = new WeakMap<Pick<AgentChatMessage, "timestamp">, number>();

export const messageTimestampMs = (message: Pick<AgentChatMessage, "timestamp">): number | null => {
  let parsed = timestampsMs.get(message);
  if (parsed === undefined) {
    parsed = Date.parse(message.timestamp);
    timestampsMs.set(message, parsed);
  }
  return Number.isNaN(parsed) ? null : parsed;
};

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
