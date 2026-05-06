import type { AgentUserMessageDisplayPart } from "@openducktor/core";
import {
  ensureVisibleUserTextDisplayParts,
  mergePreservedAttachmentDisplayParts,
  readVisibleUserTextFromDisplayParts,
} from "../../message-normalizers";
import type { QueuedUserMessageSend, SessionMessageMetadata } from "../../types";

type AttachmentDisplayPart = Extract<AgentUserMessageDisplayPart, { kind: "attachment" }>;

const readPreservedAttachmentParts = (input: {
  metadata?: SessionMessageMetadata;
  matchedQueuedSend?: QueuedUserMessageSend | null;
}): AttachmentDisplayPart[] => {
  return [
    ...(input.metadata?.displayParts?.filter(
      (part): part is AttachmentDisplayPart => part.kind === "attachment",
    ) ?? []),
    ...(input.matchedQueuedSend?.attachmentParts ?? []),
  ];
};

export const buildVisibleUserMessage = (input: {
  fallbackText: string;
  normalizedDisplayParts: AgentUserMessageDisplayPart[];
  metadata?: SessionMessageMetadata;
  matchedQueuedSend?: QueuedUserMessageSend | null;
}): {
  displayParts: AgentUserMessageDisplayPart[];
  visible: string;
} => {
  const mergedDisplayParts = mergePreservedAttachmentDisplayParts(
    input.normalizedDisplayParts,
    readPreservedAttachmentParts({
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.matchedQueuedSend ? { matchedQueuedSend: input.matchedQueuedSend } : {}),
    }),
  );
  const displayParts = ensureVisibleUserTextDisplayParts(
    mergedDisplayParts.length > 0 ? mergedDisplayParts : (input.metadata?.displayParts ?? []),
    input.fallbackText,
  );
  const textFromParts = readVisibleUserTextFromDisplayParts(displayParts);
  return {
    displayParts,
    visible: textFromParts.length > 0 ? textFromParts : input.fallbackText,
  };
};
