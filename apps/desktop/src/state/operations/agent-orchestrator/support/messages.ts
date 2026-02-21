import type { AgentChatMessage } from "@/types/agent-orchestrator";

export const upsertMessage = (
  messages: AgentChatMessage[],
  message: AgentChatMessage,
): AgentChatMessage[] => {
  const index = messages.findIndex((entry) => entry.id === message.id);
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
