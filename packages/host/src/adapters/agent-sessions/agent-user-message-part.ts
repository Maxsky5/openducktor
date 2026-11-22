import type { AgentSessionUserMessagePart } from "@openducktor/contracts";
import type { AgentUserMessagePart } from "@openducktor/core";

/** Converts a validated control message part to the core part, without an empty MIME type. */
export const toAgentUserMessagePart = (part: AgentSessionUserMessagePart): AgentUserMessagePart => {
  if (part.kind !== "attachment") {
    return part;
  }
  const { mime, ...requiredAttachment } = part.attachment;
  if (mime === undefined) {
    return { kind: "attachment", attachment: requiredAttachment };
  }
  return {
    kind: "attachment",
    attachment: { ...requiredAttachment, mime },
  };
};
