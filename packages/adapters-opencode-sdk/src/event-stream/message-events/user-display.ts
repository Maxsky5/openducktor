import type { AgentUserMessageDisplayPart } from "@openducktor/core";
import {
  ensureVisibleUserTextDisplayParts,
  mergePreservedAttachmentDisplayParts,
  normalizeUserMessageDisplayParts,
  readVisibleUserTextFromDisplayParts,
} from "../../message-normalizers";
import type { QueuedUserMessageSend, SessionMessageMetadata } from "../../types";
import type { EventStreamRuntime } from "../shared";
import { getKnownMessageParts } from "./helpers";

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

export const buildKnownUserMessageContent = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    visible?: string;
    displayParts?: AgentUserMessageDisplayPart[];
  },
): { visible: string; displayParts: AgentUserMessageDisplayPart[] } | null => {
  const session = runtime.getSession(runtime.externalSessionId);
  const metadata = session?.messageMetadataById.get(input.messageId);
  const knownDisplayParts = normalizeUserMessageDisplayParts(
    getKnownMessageParts(runtime, input.messageId),
  );
  const fallbackText = metadata?.text ?? "";
  const displayParts =
    input.displayParts ??
    ensureVisibleUserTextDisplayParts(
      knownDisplayParts.length > 0 ? knownDisplayParts : (metadata?.displayParts ?? []),
      fallbackText,
    );
  const textFromParts = input.visible ?? readVisibleUserTextFromDisplayParts(displayParts);
  const visible = textFromParts.length > 0 ? textFromParts : fallbackText;
  if (visible.trim().length === 0 && displayParts.length === 0) {
    return null;
  }

  return { visible, displayParts };
};
