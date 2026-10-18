import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";

export const isAssistantMessageStreaming = (message: AgentChatMessage): boolean =>
  message.role === "assistant" &&
  message.meta?.kind === "assistant" &&
  message.meta.isFinal === false;
