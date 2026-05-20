import type { AgentSessionHistoryMessage } from "@openducktor/core";

export const isFinalAssistantHistoryMessage = (message: AgentSessionHistoryMessage): boolean => {
  if (message.role !== "assistant") {
    return false;
  }

  return message.parts.some(
    (part) => part.kind === "step" && part.phase === "finish" && part.reason === "stop",
  );
};
