import { preferredMessageTimestamp } from "./message-timestamp";
import { settleImageGenerationMessage } from "./image-generation-settlement";
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
  owner: Pick<
    AgentSessionState,
    | "externalSessionId"
    | "messages"
    | "imageGenerationEnd"
    | "imageGenerationFailureTimestamp"
    | "imageGenerationTurnEnds"
    | "imageGenerationTurnStarts"
  >,
  part: AgentImageGenerationPart,
  timestamp: string,
): AgentSessionState["messages"] => {
  const message = createImageGenerationMessage(part, timestamp);
  const current = findSessionMessageById(owner, message.id);
  if (current?.meta?.kind === "image_generation") {
    message.meta = mergeAgentImageGeneration(current.meta, part, "live");
    message.timestamp = preferredMessageTimestamp(current, message).timestamp;
  }
  return upsertSessionMessage(
    owner,
    settleImageGenerationMessage(
      message,
      owner.imageGenerationEnd,
      owner.imageGenerationTurnEnds,
      owner.imageGenerationTurnStarts,
      owner.imageGenerationFailureTimestamp,
    ),
  );
};
