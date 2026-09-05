import type { AgentImageGenerationPart } from "@openducktor/contracts";
import { mergeAgentImageGeneration } from "@openducktor/core";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { toImageGenerationMessageId } from "./chat-message-ids";
import { findSessionMessageById, upsertSessionMessage } from "./messages";

export const createImageGenerationMessage = (
  part: AgentImageGenerationPart,
  timestamp: string,
): AgentChatMessage => ({
  id: toImageGenerationMessageId(part.itemId, part.turnId),
  role: "assistant",
  content: "",
  timestamp,
  meta: part,
});

export const upsertImageGenerationMessage = (
  owner: Pick<AgentSessionState, "externalSessionId" | "messages">,
  part: AgentImageGenerationPart,
  timestamp: string,
): AgentSessionState["messages"] => {
  const message = createImageGenerationMessage(part, timestamp);
  const current = findSessionMessageById(owner, message.id);
  if (current?.meta?.kind === "image_generation") {
    message.meta = mergeAgentImageGeneration(current.meta, part, "live");
    message.timestamp = current.timestamp;
  }
  return upsertSessionMessage(owner, message);
};
