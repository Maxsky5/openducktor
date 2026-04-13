import {
  type AgentUserMessagePart,
  type AgentUserMessagePromptFileReference,
  normalizeAgentUserMessageParts,
} from "@openducktor/core";

const WORDLIKE_TEXT_START_PATTERN = /[\p{L}\p{N}_]/u;

const encodeOpenCodePartToText = (part: AgentUserMessagePart): string | null => {
  if (part.kind === "text") {
    return part.text;
  }
  if (part.kind === "slash_command") {
    return `/${part.command.trigger}`;
  }
  if (part.kind === "file_reference") {
    return `@${part.file.path}`;
  }
  return null;
};

const shouldInsertSyntheticSpaceBeforePart = (
  previousPart: AgentUserMessagePart | null,
  part: AgentUserMessagePart,
): boolean => {
  if (!previousPart || previousPart.kind === "text") {
    return false;
  }

  if (part.kind !== "text") {
    return true;
  }

  const firstCharacter = part.text.at(0);
  return firstCharacter !== undefined && WORDLIKE_TEXT_START_PATTERN.test(firstCharacter);
};

const collapseLeadingWhitespaceAfterSkippedPart = (
  existingText: string,
  nextText: string,
  skippedStructuredPart: boolean,
): string => {
  if (!skippedStructuredPart) {
    return nextText;
  }
  if (!/\s$/u.test(existingText)) {
    return nextText;
  }
  return nextText.replace(/^\s+/u, "");
};

const buildOpenCodeMessageEncoding = (
  parts: AgentUserMessagePart[],
): {
  text: string;
  fileReferences: AgentUserMessagePromptFileReference[];
} => {
  const normalized = normalizeAgentUserMessageParts(parts);
  let text = "";
  const fileReferences: AgentUserMessagePromptFileReference[] = [];
  let previousPart: AgentUserMessagePart | null = null;
  let skippedStructuredPart = false;

  for (const part of normalized) {
    if (shouldInsertSyntheticSpaceBeforePart(previousPart, part)) {
      text += " ";
    }

    const encodedPart = encodeOpenCodePartToText(part);
    if (encodedPart === null) {
      skippedStructuredPart = true;
      continue;
    }

    if (part.kind === "text") {
      text += collapseLeadingWhitespaceAfterSkippedPart(text, encodedPart, skippedStructuredPart);
      previousPart = part;
      skippedStructuredPart = false;
      continue;
    }

    if (part.kind === "file_reference") {
      const start = text.length;
      text += encodedPart;
      fileReferences.push({
        file: part.file,
        sourceText: {
          value: encodedPart,
          start,
          end: text.length,
        },
      });
      previousPart = part;
      skippedStructuredPart = false;
      continue;
    }

    text += encodedPart;
    previousPart = part;
    skippedStructuredPart = false;
  }

  return { text, fileReferences };
};

export const buildOpenCodeVisibleText = (parts: AgentUserMessagePart[]): string => {
  return buildOpenCodeMessageEncoding(parts).text;
};

export const buildOpenCodePromptText = (
  parts: AgentUserMessagePart[],
): {
  text: string;
  fileReferences: AgentUserMessagePromptFileReference[];
} => {
  return buildOpenCodeMessageEncoding(parts);
};
