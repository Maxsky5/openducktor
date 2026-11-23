import type { AgentEvent } from "@openducktor/core";
import type { AgentChatMessage } from "../../../types/agent-orchestrator";

/** A user message in any state, `pending` included: the transcript shows each one. */
type UserMessageEvent = Extract<AgentEvent, { type: "user_message" }>;

const toUserMessageMeta = (event: UserMessageEvent) => {
  const model = event.model;
  const parts = Array.isArray(event.parts) ? event.parts : [];
  const meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "user" }> = {
    kind: "user",
    state: event.state,
  };
  if (model?.providerId) {
    meta.providerId = model.providerId;
  }
  if (model?.modelId) {
    meta.modelId = model.modelId;
  }
  if (model?.variant) {
    meta.variant = model.variant;
  }
  if (model?.profileId) {
    meta.profileId = model.profileId;
  }
  if (parts.length > 0) {
    meta.parts = parts;
  }
  return meta;
};

export const toUserChatMessage = (
  event: UserMessageEvent,
): AgentChatMessage & { role: "user" } => ({
  id: event.messageId,
  role: "user",
  content: event.message,
  timestamp: event.timestamp,
  meta: toUserMessageMeta(event),
});
