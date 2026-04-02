import type {
  AgentUserMessagePart,
  AgentUserMessagePromptFileReference,
} from "../types/agent-orchestrator";

const WORDLIKE_TEXT_START_PATTERN = /[\p{L}\p{N}_]/u;

const serializeAgentUserMessagePart = (part: AgentUserMessagePart): string | null => {
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

const trimBoundaryTextPart = (
  part: AgentUserMessagePart,
  edge: "start" | "end",
): AgentUserMessagePart => {
  if (part.kind !== "text") {
    return part;
  }
  return {
    ...part,
    text: edge === "start" ? part.text.trimStart() : part.text.trimEnd(),
  };
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

export const normalizeAgentUserMessageParts = (
  parts: AgentUserMessagePart[],
): AgentUserMessagePart[] => {
  const merged = parts.reduce<AgentUserMessagePart[]>((acc, part) => {
    if (part.kind === "text") {
      const previous = acc[acc.length - 1];
      if (previous?.kind === "text") {
        previous.text += part.text;
        return acc;
      }
    }

    acc.push(part.kind === "text" ? { ...part } : part);
    return acc;
  }, []);

  if (merged.length === 0) {
    return [];
  }

  const normalized = merged.map((part, index) => {
    if (index === 0) {
      return trimBoundaryTextPart(part, "start");
    }
    if (index === merged.length - 1) {
      return trimBoundaryTextPart(part, "end");
    }
    return part;
  });

  return normalized.filter((part) => part.kind !== "text" || part.text.length > 0);
};

export const hasMeaningfulAgentUserMessageParts = (parts: AgentUserMessagePart[]): boolean => {
  return normalizeAgentUserMessageParts(parts).length > 0;
};

export const serializeAgentUserMessagePartsToText = (parts: AgentUserMessagePart[]): string => {
  const normalized = normalizeAgentUserMessageParts(parts);
  let text = "";
  let previousPart: AgentUserMessagePart | null = null;
  let skippedStructuredPart = false;

  for (const part of normalized) {
    if (shouldInsertSyntheticSpaceBeforePart(previousPart, part)) {
      text += " ";
    }
    const serializedPart = serializeAgentUserMessagePart(part);
    if (serializedPart === null) {
      skippedStructuredPart = true;
      continue;
    }
    text +=
      part.kind === "text"
        ? collapseLeadingWhitespaceAfterSkippedPart(text, serializedPart, skippedStructuredPart)
        : serializedPart;
    previousPart = part;
    skippedStructuredPart = false;
  }

  return text;
};

export const buildAgentUserMessagePromptText = (
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

    const serializedPart = serializeAgentUserMessagePart(part);

    if (serializedPart === null) {
      skippedStructuredPart = true;
      continue;
    }

    if (part.kind === "text" || part.kind === "slash_command") {
      text +=
        part.kind === "text"
          ? collapseLeadingWhitespaceAfterSkippedPart(text, serializedPart, skippedStructuredPart)
          : serializedPart;
      previousPart = part;
      skippedStructuredPart = false;
      continue;
    }

    if (part.kind !== "file_reference") {
      continue;
    }

    const start = text.length;
    text += serializedPart;
    fileReferences.push({
      file: part.file,
      sourceText: {
        value: serializedPart,
        start,
        end: text.length,
      },
    });
    previousPart = part;
    skippedStructuredPart = false;
  }

  return { text, fileReferences };
};
