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

export const utf8ByteLength = (text: string): number => new TextEncoder().encode(text).length;

const stringRangeFromUtf8ByteRange = (
  text: string,
  byteRange: { start: number; end: number },
): { start: number; end: number } | null => {
  if (byteRange.start < 0 || byteRange.end <= byteRange.start) {
    return null;
  }

  let byteOffset = 0;
  let rangeStart: number | null = null;
  let rangeEnd: number | null = null;
  for (let index = 0; index < text.length; ) {
    if (byteOffset === byteRange.start) {
      rangeStart = index;
    }
    if (byteOffset === byteRange.end) {
      rangeEnd = index;
      break;
    }

    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const character = String.fromCodePoint(codePoint);
    byteOffset += utf8ByteLength(character);
    index += character.length;
  }

  if (rangeStart === null && byteOffset === byteRange.start) {
    rangeStart = text.length;
  }
  if (rangeEnd === null && byteOffset === byteRange.end) {
    rangeEnd = text.length;
  }

  if (rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart) {
    return null;
  }
  return { start: rangeStart, end: rangeEnd };
};

const skillReferenceFromMarker = (
  marker: string,
  skillsByMarker: Map<string, AgentSkillReference[]>,
): AgentSkillReference | null => {
  const skill = skillsByMarker.get(marker)?.shift();
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

const codexTextElementRange = (
  input: CodexTextInput,
  element: CodexTextElement,
): { start: number; end: number } | null => {
  return stringRangeFromUtf8ByteRange(input.text, element.byteRange);
};

const codexTextElementMarker = (
  input: CodexTextInput,
  element: CodexTextElement,
  range: { start: number; end: number },
): string => {
  return element.placeholder ?? input.text.slice(range.start, range.end);
};

const buildCodexSkillsByMarker = (input: CodexUserInput[]): Map<string, AgentSkillReference[]> => {
  const skillsByMarker = new Map<string, AgentSkillReference[]>();
  for (const entry of input) {
    if (entry.type !== "skill") {
      continue;
    }

    const marker = `$${entry.name}`;
    const skills = skillsByMarker.get(marker);
    if (skills) {
      skills.push(codexSkillReferenceFromInput(entry));
    } else {
      skillsByMarker.set(marker, [codexSkillReferenceFromInput(entry)]);
    }
  }
  return skillsByMarker;
};

type CodexTextDisplayParts = {
  parts: AgentUserMessageDisplayPart[];
  renderedSkillIds: Set<string>;
};

const plainTextDisplayParts = (text: string): CodexTextDisplayParts => ({
  parts: [{ kind: "text", text }],
  renderedSkillIds: new Set(),
});

const codexSkillMentionFromTextElement = (
  input: CodexTextInput,
  element: CodexTextElement,
  textOffset: number,
  skillsByMarker: Map<string, AgentSkillReference[]>,
): {
  marker: string;
  part: Extract<AgentUserMessageDisplayPart, { kind: "skill_mention" }>;
} | null => {
  const range = codexTextElementRange(input, element);
  if (!range) {
    return null;
  }

  const marker = codexTextElementMarker(input, element, range);
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
        value: input.text.slice(range.start, range.end),
        start: textOffset + range.start,
        end: textOffset + range.end,
      },
    },
  };
};

const codexTextInputToDisplayParts = (
  input: CodexTextInput,
  textOffset: number,
  skillsByMarker: Map<string, AgentSkillReference[]>,
): CodexTextDisplayParts => {
  const elements = [...(input.text_elements ?? [])].sort(
    (left, right) => left.byteRange.start - right.byteRange.start,
  );
  if (elements.length === 0) {
    return plainTextDisplayParts(input.text);
  }

  const parts: AgentUserMessageDisplayPart[] = [];
  const renderedSkillIds = new Set<string>();
  let cursor = 0;
  for (const element of elements) {
    const range = codexTextElementRange(input, element);
    if (!range) {
      continue;
    }

    const start = range.start;
    const end = range.end;
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
    renderedSkillIds.add(skillMention.part.skill.id);
    cursor = end;
  }
  if (parts.length === 0) {
    return plainTextDisplayParts(input.text);
  }
  if (cursor < input.text.length) {
    parts.push({ kind: "text", text: input.text.slice(cursor) });
  }
  return { parts, renderedSkillIds };
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

const collectCodexMarkedSkillMarkerCounts = (input: CodexUserInput[]): Map<string, number> => {
  const markers = new Map<string, number>();
  for (const entry of input) {
    if (entry.type !== "text") {
      continue;
    }
    for (const element of entry.text_elements ?? []) {
      const range = codexTextElementRange(entry, element);
      if (!range) {
        continue;
      }
      const marker = codexTextElementMarker(entry, element, range);
      if (marker.startsWith("$")) {
        markers.set(marker, (markers.get(marker) ?? 0) + 1);
      }
    }
  }
  return markers;
};

const consumeMarker = (markers: Map<string, number>, marker: string): boolean => {
  const count = markers.get(marker) ?? 0;
  if (count <= 0) {
    return false;
  }
  if (count === 1) {
    markers.delete(marker);
  } else {
    markers.set(marker, count - 1);
  }
  return true;
};

const codexUserInputTextContributions = (input: CodexUserInput[]): string[] => {
  const markedSkills = collectCodexMarkedSkillMarkerCounts(input);
  return input.map((current, index) => {
    if (current.type !== "skill") {
      return userInputText(current);
    }

    const marker = `$${current.name}`;
    if (consumeMarker(markedSkills, marker)) {
      return "";
    }
    const previous = input[index - 1];
    if (previous?.type === "text" && previous.text.endsWith(marker)) {
      return "";
    }
    return userInputText(current);
  });
};

const appendedTextStartOffset = (text: string, next: string): number => {
  if (text.length === 0 || next.length === 0) {
    return text.length;
  }
  if (/\s$/.test(text) || /^\s/.test(next)) {
    return text.length;
  }
  return text.length + 1;
};

export const codexUserInputsToDisplayParts = (
  input: CodexUserInput[],
  messageId: string,
): AgentUserMessageDisplayPart[] => {
  const parts: AgentUserMessageDisplayPart[] = [];
  const skillsByMarker = buildCodexSkillsByMarker(input);
  const renderedSkillIds = new Set<string>();
  const textContributions = codexUserInputTextContributions(input);
  let accumulatedText = "";
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];
    if (!current) {
      continue;
    }
    const partText = textContributions[index] ?? "";
    const textOffset = appendedTextStartOffset(accumulatedText, partText);
    if (current.type === "text" && (current.text_elements?.length ?? 0) > 0) {
      const textResult = codexTextInputToDisplayParts(current, textOffset, skillsByMarker);
      parts.push(...textResult.parts);
      for (const skillId of textResult.renderedSkillIds) {
        renderedSkillIds.add(skillId);
      }
      accumulatedText = appendUserInputText(accumulatedText, partText);
      continue;
    }
    if (
      current.type === "skill" &&
      renderedSkillIds.has(codexSkillReferenceFromInput(current).id)
    ) {
      accumulatedText = appendUserInputText(accumulatedText, partText);
      continue;
    }
    if (current.type === "text" && next?.type === "skill") {
      const echoParts = codexTextSkillEchoToDisplayParts(current, next);
      if (echoParts) {
        parts.push(...echoParts);
        accumulatedText = appendUserInputText(accumulatedText, partText);
        accumulatedText = appendUserInputText(accumulatedText, textContributions[index + 1] ?? "");
        index += 1;
        continue;
      }
    }
    parts.push(codexUserInputToDisplayPart(current, messageId, index));
    accumulatedText = appendUserInputText(accumulatedText, partText);
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
  return codexUserInputTextContributions(input).reduce(appendUserInputText, "");
};
