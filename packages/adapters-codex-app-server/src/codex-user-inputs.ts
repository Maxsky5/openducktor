import type { AgentUserMessagePart } from "@openducktor/core";
import { arrayFromUnknown, isPlainObject } from "./codex-app-server-shared";
import { utf8ByteLength } from "./codex-user-input-display";
import type { CodexTextElement, CodexUserInput } from "./types";

const codexTextElementFromUnknown = (entry: unknown): CodexTextElement | null => {
  if (!isPlainObject(entry)) {
    return null;
  }
  const byteRange = entry.byteRange ?? entry.byte_range;
  if (!isPlainObject(byteRange)) {
    return null;
  }
  const start = byteRange.start;
  const end = byteRange.end;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return null;
  }
  const placeholder = entry.placeholder;
  return {
    byteRange: { start, end },
    placeholder: typeof placeholder === "string" ? placeholder : null,
  };
};

const codexTextElementsFromUnknown = (value: unknown): CodexTextElement[] =>
  arrayFromUnknown(value)
    .map(codexTextElementFromUnknown)
    .filter((entry): entry is CodexTextElement => Boolean(entry));

const codexUserInputFromUnknown = (entry: unknown): CodexUserInput | null => {
  if (!isPlainObject(entry)) {
    return null;
  }
  if (entry.type === "text" && typeof entry.text === "string") {
    return {
      type: "text",
      text: entry.text,
      text_elements: codexTextElementsFromUnknown(entry.text_elements ?? entry.textElements ?? []),
    };
  }
  if (
    entry.type === "mention" &&
    typeof entry.name === "string" &&
    typeof entry.path === "string"
  ) {
    return { type: "mention", name: entry.name, path: entry.path };
  }
  if (entry.type === "skill" && typeof entry.name === "string" && typeof entry.path === "string") {
    return { type: "skill", name: entry.name, path: entry.path };
  }
  if (entry.type === "localImage" && typeof entry.path === "string") {
    return { type: "localImage", path: entry.path };
  }
  return null;
};

export const codexUserInputsFromItem = (item: Record<string, unknown>): CodexUserInput[] => {
  return arrayFromUnknown(item.content)
    .map(codexUserInputFromUnknown)
    .filter((entry): entry is CodexUserInput => Boolean(entry));
};

const toCodexUserInput = (part: AgentUserMessagePart): CodexUserInput => {
  if (part.kind === "text") {
    return { type: "text", text: part.text };
  }
  if (part.kind === "file_reference") {
    return { type: "mention", name: part.file.name, path: part.file.path };
  }
  if (part.kind === "skill_mention") {
    if (part.skill.name.trim().length === 0 || part.skill.path.trim().length === 0) {
      throw new Error("Codex skill references require a non-empty name and path.");
    }
    return { type: "skill", name: part.skill.name, path: part.skill.path };
  }
  if (part.kind === "attachment" && part.attachment.kind === "image") {
    return { type: "localImage", path: part.attachment.path };
  }

  throw new Error(`Codex app-server does not support '${part.kind}' user message parts.`);
};

export const toCodexUserInputList = (parts: AgentUserMessagePart[]): CodexUserInput[] => {
  return parts.map(toCodexUserInput);
};

const wordlikeTextStartPattern = /[\p{L}\p{N}_]/u;

const codexMarkerNeedsTrailingSpaceBefore = (part: AgentUserMessagePart | undefined): boolean => {
  if (!part) {
    return false;
  }
  if (part.kind === "text") {
    const firstCharacter = part.text.at(0);
    return firstCharacter !== undefined && wordlikeTextStartPattern.test(firstCharacter);
  }
  return part.kind === "file_reference" || part.kind === "skill_mention";
};

const toCodexMarkedTextInput = (
  text: string,
  placeholder: string,
  marker = text,
): CodexUserInput => ({
  type: "text",
  text,
  text_elements: [
    {
      byteRange: { start: 0, end: utf8ByteLength(marker) },
      placeholder,
    },
  ],
});

export const toCodexTurnInputList = (parts: AgentUserMessagePart[]): CodexUserInput[] => {
  return parts.flatMap((part, index): CodexUserInput[] => {
    if (part.kind === "file_reference") {
      const marker = `@${part.file.path}`;
      const placeholder = `@${part.file.name || part.file.path}`;
      const text = codexMarkerNeedsTrailingSpaceBefore(parts[index + 1]) ? `${marker} ` : marker;
      return [toCodexMarkedTextInput(text, placeholder, marker), toCodexUserInput(part)];
    }
    if (part.kind !== "skill_mention") {
      return [toCodexUserInput(part)];
    }
    const marker = `$${part.skill.name}`;
    const text = codexMarkerNeedsTrailingSpaceBefore(parts[index + 1]) ? `${marker} ` : marker;
    return [toCodexMarkedTextInput(text, marker, marker), toCodexUserInput(part)];
  });
};
