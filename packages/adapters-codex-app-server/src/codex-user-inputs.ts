import type { CodexAppServerThreadItem } from "@openducktor/contracts";
import type { AgentUserMessagePart } from "@openducktor/core";
import { utf8ByteLength } from "./codex-user-input-display";
import type { CodexUserInput } from "./types";

type CodexUserMessageItem = Extract<CodexAppServerThreadItem, { type: "userMessage" }>;

export const codexUserInputsFromItem = (item: CodexUserMessageItem): CodexUserInput[] =>
  item.content;

const toCodexUserInput = (part: AgentUserMessagePart): CodexUserInput => {
  if (part.kind === "text") {
    return { type: "text", text: part.text, text_elements: [] };
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

export const assertCodexUserMessagePartsSupported = (parts: AgentUserMessagePart[]): void => {
  void toCodexTurnInputList(parts);
};
