import type { AcceptedAgentUserMessage } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";

const toUserMessageMeta = (event: AcceptedAgentUserMessage) => {
  const model = event.model;
  const parts = Array.isArray(event.parts) ? event.parts : [];
  return {
    kind: "user" as const,
    state: event.state,
    ...(() => {
      if (model?.providerId) {
        return { providerId: model.providerId };
      }
      return {};
    })(),
    ...(() => {
      if (model?.modelId) {
        return { modelId: model.modelId };
      }
      return {};
    })(),
    ...(() => {
      if (model?.variant) {
        return { variant: model.variant };
      }
      return {};
    })(),
    ...(() => {
      if (model?.profileId) {
        return { profileId: model.profileId };
      }
      return {};
    })(),
    ...(() => {
      if (parts.length > 0) {
        return { parts };
      }
      return {};
    })(),
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
