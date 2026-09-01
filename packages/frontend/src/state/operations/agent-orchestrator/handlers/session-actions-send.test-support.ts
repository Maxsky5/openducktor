import type {
  AcceptedAgentUserMessage,
  AgentEnginePort,
  AgentUserMessagePart,
} from "@openducktor/core";
import { serializeAgentUserMessagePartsToText } from "@openducktor/core";

export const acceptedUserMessage = (
  input: Pick<
    Parameters<AgentEnginePort["sendUserMessage"]>[0],
    "externalSessionId" | "model" | "parts"
  >,
  messageId = "accepted-user-message",
): AcceptedAgentUserMessage => {
  // SAFETY: Both types use the same message parts; only optional field syntax differs.
  const parts = input.parts as AgentUserMessagePart[];
  const event: AcceptedAgentUserMessage = {
    type: "user_message",
    externalSessionId: input.externalSessionId,
    timestamp: "2026-02-22T08:00:01.000Z",
    messageId,
    message: serializeAgentUserMessagePartsToText(parts),
    parts: [],
    state: "read",
  };
  if (input.model) {
    event.model = input.model;
  }
  return event;
};
