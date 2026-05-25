import type {
  AgentSkillReference,
  AgentUserMessageDisplayPart,
  AgentUserMessagePart,
} from "@openducktor/core";
import type { CodexTextElement, CodexUserInput } from "./types";

type CodexTextInput = Extract<CodexUserInput, { type: "text" }>;
type CodexSkillInput = Extract<CodexUserInput, { type: "skill" }>;

export const toDisplayPart = (part: AgentUserMessagePart): AgentUserMessageDisplayPart | null => {
  if (part.kind === "text") {
    return { kind: "text", text: part.text };
  }
  if (part.kind === "file_reference") {
    return { kind: "file_reference", file: part.file };
  }
  if (part.kind === "skill_mention") {
    return { kind: "skill_mention", skill: part.skill };
  }
  if (part.kind === "attachment") {
    return { kind: "attachment", attachment: part.attachment };
  }
  return null;
};

export const toDisplayParts = (parts: AgentUserMessagePart[]): AgentUserMessageDisplayPart[] => {
  return parts
    .map(toDisplayPart)
    .filter((part): part is AgentUserMessageDisplayPart => Boolean(part));
};

export const userInputText = (input: CodexUserInput): string => {
  if (input.type === "text") {
    return input.text;
  }
  if (input.type === "mention") {
    return `@${input.name}`;
  }
  if (input.type === "skill") {
    return `$${input.name}`;
  }
  return input.path;
};

const stagedAttachmentUuidPrefixPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

const codexLocalImageNameFromPath = (path: string): string => {
  const fileName = path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
  if (fileName.length <= 37 || !stagedAttachmentUuidPrefixPattern.test(fileName)) {
    return fileName;
  }
  return fileName.slice(37);
};

const skillReferenceFromMarker = (
  marker: string,
  skillsByMarker: Map<string, AgentSkillReference>,
): AgentSkillReference | null => {
  const skill = skillsByMarker.get(marker);
  if (skill) {
    return skill;
  }
  const name = marker.startsWith("$") ? marker.slice(1) : marker;
  if (name.trim().length === 0) {
    return null;
  }
  return { id: marker, name, path: marker };
};

const codexSkillReferenceFromInput = (input: CodexSkillInput): AgentSkillReference => ({
  id: input.path,
  name: input.name,
  path: input.path,
});

const codexSkillInputToDisplayPart = (input: CodexSkillInput): AgentUserMessageDisplayPart => ({
  kind: "skill_mention",
  skill: codexSkillReferenceFromInput(input),
});

const codexUserInputToDisplayPart = (
  input: CodexUserInput,
  messageId: string,
  index: number,
): AgentUserMessageDisplayPart => {
  if (input.type === "text") {
    return { kind: "text", text: input.text };
  }
  if (input.type === "skill") {
    return codexSkillInputToDisplayPart(input);
  }
  if (input.type === "localImage") {
    return {
      kind: "attachment",
      attachment: {
        id: `codex-local-image:${messageId}:${index}`,
        kind: "image",
        name: codexLocalImageNameFromPath(input.path),
        path: input.path,
      },
    };
  }
  return { kind: "text", text: userInputText(input), synthetic: true };
};

const codexTextElementMarker = (input: CodexTextInput, element: CodexTextElement): string => {
  return element.placeholder ?? input.text.slice(element.byteRange.start, element.byteRange.end);
};

const buildCodexSkillsByMarker = (input: CodexUserInput[]): Map<string, AgentSkillReference> => {
  return new Map(
    input
      .filter((entry): entry is CodexSkillInput => entry.type === "skill")
      .map((entry) => [`$${entry.name}`, codexSkillReferenceFromInput(entry)]),
  );
};

type CodexTextDisplayParts = {
  parts: AgentUserMessageDisplayPart[];
  renderedSkillMarkers: Set<string>;
};

const plainTextDisplayParts = (text: string): CodexTextDisplayParts => ({
  parts: [{ kind: "text", text }],
  renderedSkillMarkers: new Set(),
});

const codexSkillMentionFromTextElement = (
  input: CodexTextInput,
  element: CodexTextElement,
  textOffset: number,
  skillsByMarker: Map<string, AgentSkillReference>,
): { marker: string; part: AgentUserMessageDisplayPart } | null => {
  const start = element.byteRange.start;
  const end = element.byteRange.end;
  const marker = codexTextElementMarker(input, element);
  if (!marker.startsWith("$")) {
    return null;
  }

  const skill = skillReferenceFromMarker(marker, skillsByMarker);
  if (!skill) {
    return null;
  }

  return {
    marker,
    part: {
      kind: "skill_mention",
      skill,
      sourceText: {
        value: input.text.slice(start, end),
        start: textOffset + start,
        end: textOffset + end,
      },
    },
  };
};

const codexTextInputToDisplayParts = (
  input: CodexTextInput,
  textOffset: number,
  skillsByMarker: Map<string, AgentSkillReference>,
): CodexTextDisplayParts => {
  const elements = [...(input.text_elements ?? [])].toSorted(
    (left, right) => left.byteRange.start - right.byteRange.start,
  );
  if (elements.length === 0) {
    return plainTextDisplayParts(input.text);
  }

  const parts: AgentUserMessageDisplayPart[] = [];
  const renderedSkillMarkers = new Set<string>();
  let cursor = 0;
  for (const element of elements) {
    const start = element.byteRange.start;
    const end = element.byteRange.end;
    if (start < cursor || start < 0 || end <= start || end > input.text.length) {
      continue;
    }
    const skillMention = codexSkillMentionFromTextElement(
      input,
      element,
      textOffset,
      skillsByMarker,
    );
    if (!skillMention) {
      continue;
    }

    if (start > cursor) {
      parts.push({ kind: "text", text: input.text.slice(cursor, start) });
    }
    parts.push(skillMention.part);
    renderedSkillMarkers.add(skillMention.marker);
    cursor = end;
  }
  if (parts.length === 0) {
    return plainTextDisplayParts(input.text);
  }
  if (cursor < input.text.length) {
    parts.push({ kind: "text", text: input.text.slice(cursor) });
  }
  return { parts, renderedSkillMarkers };
};

const codexTextSkillEchoToDisplayParts = (
  input: CodexTextInput,
  skillInput: CodexSkillInput,
): AgentUserMessageDisplayPart[] | null => {
  const marker = `$${skillInput.name}`;
  if (!input.text.endsWith(marker)) {
    return null;
  }

  const parts: AgentUserMessageDisplayPart[] = [];
  const prefix = input.text.slice(0, -marker.length);
  if (prefix.length > 0) {
    parts.push({ kind: "text", text: prefix });
  }
  parts.push(codexSkillInputToDisplayPart(skillInput));
  return parts;
};

const collectCodexMarkedSkillMarkers = (input: CodexUserInput[]): Set<string> => {
  const markers = new Set<string>();
  for (const entry of input) {
    if (entry.type !== "text") {
      continue;
    }
    for (const element of entry.text_elements ?? []) {
      const marker = codexTextElementMarker(entry, element);
      if (marker.startsWith("$")) {
        markers.add(marker);
      }
    }
  }
  return markers;
};

export const codexUserInputsToDisplayParts = (
  input: CodexUserInput[],
  messageId: string,
): AgentUserMessageDisplayPart[] => {
  const parts: AgentUserMessageDisplayPart[] = [];
  const skillsByMarker = buildCodexSkillsByMarker(input);
  const renderedSkillMarkers = new Set<string>();
  let textOffset = 0;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];
    if (!current) {
      continue;
    }
    if (current.type === "text" && (current.text_elements?.length ?? 0) > 0) {
      const textResult = codexTextInputToDisplayParts(current, textOffset, skillsByMarker);
      parts.push(...textResult.parts);
      for (const marker of textResult.renderedSkillMarkers) {
        renderedSkillMarkers.add(marker);
      }
      textOffset += current.text.length;
      continue;
    }
    if (current.type === "skill" && renderedSkillMarkers.has(`$${current.name}`)) {
      continue;
    }
    if (current.type === "text" && next?.type === "skill") {
      const echoParts = codexTextSkillEchoToDisplayParts(current, next);
      if (echoParts) {
        parts.push(...echoParts);
        textOffset += current.text.length;
        index += 1;
        continue;
      }
    }
    parts.push(codexUserInputToDisplayPart(current, messageId, index));
    if (current.type === "text") {
      textOffset += current.text.length;
    }
  }
  return parts;
};

const appendUserInputText = (text: string, next: string): string => {
  if (text.length === 0) {
    return next;
  }
  if (next.length === 0) {
    return text;
  }
  if (/\s$/.test(text) || /^\s/.test(next)) {
    return `${text}${next}`;
  }
  return `${text} ${next}`;
};

export const codexUserInputListToText = (input: CodexUserInput[]): string => {
  const markedSkills = collectCodexMarkedSkillMarkers(input);
  return input
    .map((current, index) => {
      if (current.type !== "skill") {
        return userInputText(current);
      }
      if (markedSkills.has(`$${current.name}`)) {
        return "";
      }
      const previous = input[index - 1];
      if (previous?.type === "text" && previous.text.endsWith(`$${current.name}`)) {
        return "";
      }
      return userInputText(current);
    })
    .reduce(appendUserInputText, "");
};
