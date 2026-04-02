import type { AgentChatMessage } from "@/types/agent-orchestrator";

export const findMessageIndexById = (messages: AgentChatMessage[], messageId: string): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.id === messageId) {
      return index;
    }
  }

  return -1;
};

export const findMessageById = (
  messages: AgentChatMessage[],
  messageId: string,
): AgentChatMessage | undefined => {
  const index = findMessageIndexById(messages, messageId);
  return index >= 0 ? messages[index] : undefined;
};

export const upsertMessage = (
  messages: AgentChatMessage[],
  message: AgentChatMessage,
): AgentChatMessage[] => {
  const lastIndex = messages.length - 1;
  if (lastIndex >= 0 && messages[lastIndex]?.id === message.id) {
    const next = [...messages];
    next[lastIndex] = {
      ...next[lastIndex],
      ...message,
    };
    return next;
  }

  const index = findMessageIndexById(messages, message.id);
  if (index < 0) {
    return [...messages, message];
  }

  const next = [...messages];
  next[index] = {
    ...next[index],
    ...message,
  };
  return next;
};
