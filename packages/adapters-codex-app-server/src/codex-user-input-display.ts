import {
  type AgentFileReference,
  type AgentSkillReference,
  type AgentUserMessageDisplayPart,
  type AgentUserMessagePart,
  detectAgentFileReferenceKind,
} from "@openducktor/core";
import { basenameForPath } from "@openducktor/path-support";
import type { CodexTextElement, CodexUserInput } from "./types";

type CodexTextInput = Extract<CodexUserInput, { type: "text" }>;
type CodexMentionInput = Extract<CodexUserInput, { type: "mention" }>;
type CodexSkillInput = Extract<CodexUserInput, { type: "skill" }>;

const wordlikeTextStartPattern = /[\p{L}\p{N}_]/u;

const toDisplayPart = (part: AgentUserMessagePart): AgentUserMessageDisplayPart | null => {
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
  const displayParts: AgentUserMessageDisplayPart[] = [];
  let previousPart: AgentUserMessagePart | null = null;
  for (const part of parts) {
    const displayPart = toDisplayPart(part);
    if (!displayPart) {
      previousPart = part;
      continue;
    }
    if (
      previousPart &&
      (previousPart.kind === "file_reference" || previousPart.kind === "skill_mention") &&
      displayPart.kind === "text" &&
      wordlikeTextStartPattern.test(displayPart.text.at(0) ?? "")
    ) {
      displayParts.push({ ...displayPart, text: ` ${displayPart.text}` });
    } else {
      displayParts.push(displayPart);
    }
    previousPart = part;
  }
  return displayParts;
};
const userInputText = (input: CodexUserInput): string => {
  if (input.type === "text") {
    return input.text;
  }
  if (input.type === "mention") {
    if (isCodexFileMentionInput(input)) {
      return `@${input.path}`;
    }
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
  const fileName = basenameForPath(path) || path;
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

const consumeSkillReferenceForMarker = (
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

const externalMentionSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//i;

const isCodexFileMentionInput = (input: CodexMentionInput): boolean => {
  return !externalMentionSchemePattern.test(input.path.trim());
};

const codexFileReferenceFromPath = (path: string, displayName?: string): AgentFileReference => {
  const name = displayName?.trim() || basenameForPath(path) || path;
  return {
    id: path,
    path,
    name,
    kind: detectAgentFileReferenceKind({ filePath: path }),
  };
};

const codexFileReferenceFromMentionInput = (input: CodexMentionInput): AgentFileReference => {
  return codexFileReferenceFromPath(input.path, input.name);
};

const codexFileMentionInputToDisplayPart = (
  input: CodexMentionInput,
): AgentUserMessageDisplayPart => ({
  kind: "file_reference",
  file: codexFileReferenceFromMentionInput(input),
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
  if (input.type === "mention" && isCodexFileMentionInput(input)) {
    return codexFileMentionInputToDisplayPart(input);
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

const codexFileMentionMarkers = (input: CodexMentionInput): string[] => {
  return [...new Set([`@${input.path}`, `@${input.name}`])].filter((marker) => marker.length > 1);
};

const findCodexFileMentionMarkerRange = (
  text: string,
  mention: CodexMentionInput,
): { start: number; end: number } | null => {
  let selected: { start: number; end: number } | null = null;
  for (const marker of codexFileMentionMarkers(mention)) {
    const start = text.indexOf(marker);
    if (start < 0) {
      continue;
    }
    const end = start + marker.length;
    if (
      selected === null ||
      start < selected.start ||
      (start === selected.start && end > selected.end)
    ) {
      selected = { start, end };
    }
  }
  return selected;
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
  range: { start: number; end: number },
  textOffset: number,
  skillsByMarker: Map<string, AgentSkillReference[]>,
): {
  marker: string;
  part: Extract<AgentUserMessageDisplayPart, { kind: "skill_mention" }>;
} | null => {
  const marker = codexTextElementMarker(input, element, range);
  if (!marker.startsWith("$")) {
    return null;
  }

  const skill = consumeSkillReferenceForMarker(marker, skillsByMarker);
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

const codexTextElementMatchesFileMention = (
  input: CodexTextInput,
  element: CodexTextElement,
  range: { start: number; end: number },
  mention: CodexMentionInput,
): boolean => {
  const rangeText = input.text.slice(range.start, range.end);
  return codexFileMentionMarkers(mention).some(
    (marker) => marker === rangeText || marker === codexTextElementMarker(input, element, range),
  );
};

const codexFileMentionFromTextElement = (
  input: CodexTextInput,
  element: CodexTextElement,
  range: { start: number; end: number },
  textOffset: number,
  fileMentions: CodexMentionInput[],
  renderedFileMentions: Set<CodexMentionInput>,
): {
  input: CodexMentionInput;
  part: Extract<AgentUserMessageDisplayPart, { kind: "file_reference" }>;
} | null => {
  const marker = codexTextElementMarker(input, element, range);
  if (!marker.startsWith("@")) {
    return null;
  }

  const fileMention = fileMentions.find(
    (mention) =>
      !renderedFileMentions.has(mention) &&
      codexTextElementMatchesFileMention(input, element, range, mention),
  );
  if (!fileMention) {
    return null;
  }

  return {
    input: fileMention,
    part: {
      kind: "file_reference",
      file: codexFileReferenceFromMentionInput(fileMention),
      sourceText: {
        value: input.text.slice(range.start, range.end),
        start: textOffset + range.start,
        end: textOffset + range.end,
      },
    },
  };
};

const codexFileReferenceFromTextElement = (
  input: CodexTextInput,
  element: CodexTextElement,
  range: { start: number; end: number },
  textOffset: number,
): Extract<AgentUserMessageDisplayPart, { kind: "file_reference" }> | null => {
  const sourceValue = input.text.slice(range.start, range.end);
  if (!sourceValue.startsWith("@")) {
    return null;
  }

  const path = sourceValue.slice(1).trim();
  if (path.length === 0 || externalMentionSchemePattern.test(path)) {
    return null;
  }

  const marker = codexTextElementMarker(input, element, range);
  const displayName = marker.startsWith("@") ? marker.slice(1).trim() : undefined;
  return {
    kind: "file_reference",
    file: codexFileReferenceFromPath(path, displayName),
    sourceText: {
      value: sourceValue,
      start: textOffset + range.start,
      end: textOffset + range.end,
    },
  };
};

const codexTextInputToDisplayParts = (
  input: CodexTextInput,
  textOffset: number,
  skillsByMarker: Map<string, AgentSkillReference[]>,
  fileMentions: CodexMentionInput[],
  renderedFileMentions: Set<CodexMentionInput>,
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
      range,
      textOffset,
      skillsByMarker,
    );
    const fileMention =
      skillMention === null
        ? codexFileMentionFromTextElement(
            input,
            element,
            range,
            textOffset,
            fileMentions,
            renderedFileMentions,
          )
        : null;
    const fileReference =
      skillMention === null && fileMention === null
        ? codexFileReferenceFromTextElement(input, element, range, textOffset)
        : null;
    const referencePart = skillMention?.part ?? fileMention?.part ?? fileReference;
    if (!referencePart) {
      continue;
    }

    if (start > cursor) {
      parts.push({ kind: "text", text: input.text.slice(cursor, start) });
    }
    parts.push(referencePart);
    if (referencePart.kind === "skill_mention") {
      renderedSkillIds.add(referencePart.skill.id);
    } else if (fileMention) {
      renderedFileMentions.add(fileMention.input);
    }
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

const codexTextFileEchoToDisplayParts = (
  input: CodexTextInput,
  fileInput: CodexMentionInput,
  textOffset: number,
): AgentUserMessageDisplayPart[] | null => {
  const range = findCodexFileMentionMarkerRange(input.text, fileInput);
  if (!range) {
    return null;
  }

  const parts: AgentUserMessageDisplayPart[] = [];
  const prefix = input.text.slice(0, range.start);
  if (prefix.length > 0) {
    parts.push({ kind: "text", text: prefix });
  }
  parts.push({
    kind: "file_reference",
    file: codexFileReferenceFromMentionInput(fileInput),
    sourceText: {
      value: input.text.slice(range.start, range.end),
      start: textOffset + range.start,
      end: textOffset + range.end,
    },
  });
  const suffix = input.text.slice(range.end);
  if (suffix.length > 0) {
    parts.push({ kind: "text", text: suffix });
  }
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

const textInputHasFileMentionMarker = (
  input: CodexTextInput,
  mention: CodexMentionInput,
): boolean => {
  return findCodexFileMentionMarkerRange(input.text, mention) !== null;
};

const textInputHasFileMentionElement = (
  input: CodexTextInput,
  mention: CodexMentionInput,
): boolean => {
  return (input.text_elements ?? []).some((element) => {
    const range = codexTextElementRange(input, element);
    return range ? codexTextElementMatchesFileMention(input, element, range, mention) : false;
  });
};

const codexUserInputTextContributions = (input: CodexUserInput[]): string[] => {
  const markedSkills = collectCodexMarkedSkillMarkerCounts(input);
  return input.map((current, index) => {
    if (current.type !== "skill" && current.type !== "mention") {
      return userInputText(current);
    }
    if (current.type === "mention") {
      if (!isCodexFileMentionInput(current)) {
        return userInputText(current);
      }
      const previous = input[index - 1];
      if (
        previous?.type === "text" &&
        (textInputHasFileMentionElement(previous, current) ||
          textInputHasFileMentionMarker(previous, current))
      ) {
        return "";
      }
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
  const fileMentions = input.filter(
    (entry): entry is CodexMentionInput =>
      entry.type === "mention" && isCodexFileMentionInput(entry),
  );
  const renderedSkillIds = new Set<string>();
  const renderedFileMentions = new Set<CodexMentionInput>();
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
      const textResult = codexTextInputToDisplayParts(
        current,
        textOffset,
        skillsByMarker,
        fileMentions,
        renderedFileMentions,
      );
      parts.push(...textResult.parts);
      for (const skillId of textResult.renderedSkillIds) {
        renderedSkillIds.add(skillId);
      }
      accumulatedText = appendUserInputText(accumulatedText, partText);
      continue;
    }
    if (current.type === "text" && next?.type === "mention" && isCodexFileMentionInput(next)) {
      const echoParts = codexTextFileEchoToDisplayParts(current, next, textOffset);
      if (echoParts) {
        parts.push(...echoParts);
        renderedFileMentions.add(next);
        accumulatedText = appendUserInputText(accumulatedText, partText);
        accumulatedText = appendUserInputText(accumulatedText, textContributions[index + 1] ?? "");
        index += 1;
        continue;
      }
    }
    if (current.type === "skill" && renderedSkillIds.has(current.path)) {
      accumulatedText = appendUserInputText(accumulatedText, partText);
      continue;
    }
    if (
      current.type === "mention" &&
      isCodexFileMentionInput(current) &&
      renderedFileMentions.has(current)
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
