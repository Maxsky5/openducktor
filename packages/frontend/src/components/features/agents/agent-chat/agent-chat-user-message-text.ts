import type { AgentUserMessageDisplayPart } from "@openducktor/core";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { isUserMessageReferencePart } from "./agent-chat-user-message-reference-chip";

export type UserAttachmentPart = Extract<AgentUserMessageDisplayPart, { kind: "attachment" }>;

const USER_MESSAGE_SUMMARY_MAX_LENGTH = 120;

/**
 * The start of the first line of a user message as plain text, for an accessible name. A message
 * without text names its attachments, and an empty message gives an empty string.
 */
export const readUserMessageSummary = (message: AgentChatMessage): string => {
  const userParts = readUserMessageParts(message);
  const firstLine = readRenderableUserMessageText(userParts, message.content)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    const names = userParts.filter(isUserAttachmentPart).map((part) => part.attachment.name);
    return names.length > 0 ? `Attachments: ${names.join(", ")}` : "";
  }
  return firstLine.length > USER_MESSAGE_SUMMARY_MAX_LENGTH
    ? `${firstLine.slice(0, USER_MESSAGE_SUMMARY_MAX_LENGTH)}…`
    : firstLine;
};

export const isUserAttachmentPart = (
  part: AgentUserMessageDisplayPart,
): part is UserAttachmentPart => part.kind === "attachment";

export const readUserMessageParts = (message: AgentChatMessage): AgentUserMessageDisplayPart[] =>
  message.meta?.kind === "user" ? (message.meta.parts ?? []) : [];

export const readVisibleUserMessageText = (parts: AgentUserMessageDisplayPart[]): string => {
  let text = "";
  for (const part of parts) {
    if (part.kind === "text" && !part.synthetic) {
      text += part.text;
    }
  }
  return text;
};

export const readRenderableUserMessageText = (
  parts: AgentUserMessageDisplayPart[],
  fallbackText: string,
): string => {
  if (parts.some((part) => isUserMessageReferencePart(part) && part.sourceText)) {
    return fallbackText;
  }
  const visibleText = readVisibleUserMessageText(parts);
  if (visibleText.length > 0) {
    return visibleText;
  }
  return fallbackText;
};
