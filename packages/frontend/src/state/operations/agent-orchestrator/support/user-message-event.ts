import type { AcceptedAgentUserMessage } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";

const toUserMessageMeta = (event: AcceptedAgentUserMessage) => {
  const model = event.model;
  const parts = Array.isArray(event.parts) ? event.parts : [];
  return {
    kind: "user" as const,
    state: event.state,
    ...(model?.providerId ? { providerId: model.providerId } : {}),
    ...(model?.modelId ? { modelId: model.modelId } : {}),
    ...(model?.variant ? { variant: model.variant } : {}),
    ...(model?.profileId ? { profileId: model.profileId } : {}),
    ...(parts.length > 0 ? { parts } : {}),
  };
};

export const toUserChatMessage = (
  event: AcceptedAgentUserMessage,
): AgentChatMessage & { role: "user" } => ({
  id: event.messageId,
  role: "user",
  content: event.message,
  timestamp: event.timestamp,
  meta: toUserMessageMeta(event),
});
