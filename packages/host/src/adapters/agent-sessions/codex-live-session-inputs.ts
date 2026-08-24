import type { AgentSessionUserMessagePart } from "@openducktor/contracts";
import type { AgentUserMessagePart } from "@openducktor/core";

export const toCodexUserMessagePart = (part: AgentSessionUserMessagePart): AgentUserMessagePart => {
  if (part.kind !== "attachment") {
    return part;
  }
  const { mime, ...requiredAttachment } = part.attachment;
  return {
    kind: "attachment",
    attachment: {
      ...requiredAttachment,
      ...(mime === undefined ? undefined : { mime }),
    },
  };
};
