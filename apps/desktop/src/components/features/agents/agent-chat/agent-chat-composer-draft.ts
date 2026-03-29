import type { AgentSlashCommand, AgentUserMessagePart } from "@openducktor/core";

export type AgentChatComposerTextSegment = {
  id: string;
  kind: "text";
  text: string;
};

export type AgentChatComposerSlashCommandSegment = {
  id: string;
  kind: "slash_command";
  command: AgentSlashCommand;
};

export type AgentChatComposerSegment =
  | AgentChatComposerTextSegment
  | AgentChatComposerSlashCommandSegment;

export type AgentChatComposerDraft = {
  segments: AgentChatComposerSegment[];
};

export type AgentChatSlashTriggerMatch = {
  query: string;
  rangeStart: number;
  rangeEnd: number;
};

const createSegmentId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `segment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createTextSegment = (
  text = "",
  id = createSegmentId(),
): AgentChatComposerTextSegment => ({
  id,
  kind: "text",
  text,
});

export const createSlashCommandSegment = (
  command: AgentSlashCommand,
  id = createSegmentId(),
): AgentChatComposerSlashCommandSegment => ({
  id,
  kind: "slash_command",
  command,
});

export const createEmptyComposerDraft = (): AgentChatComposerDraft => ({
  segments: [createTextSegment("")],
});

export const isTextSegment = (
  segment: AgentChatComposerSegment,
): segment is AgentChatComposerTextSegment => segment.kind === "text";

export const normalizeComposerDraft = (draft: AgentChatComposerDraft): AgentChatComposerDraft => {
  const normalized: AgentChatComposerSegment[] = [];

  for (const segment of draft.segments) {
    if (segment.kind === "text") {
      const previous = normalized[normalized.length - 1];
      if (previous?.kind === "text") {
        previous.text += segment.text;
        continue;
      }
      normalized.push({ ...segment });
      continue;
    }

    if (normalized.length === 0) {
      normalized.push(createTextSegment(""));
    }
    if (normalized[normalized.length - 1]?.kind !== "text") {
      normalized.push(createTextSegment(""));
    }
    normalized.push(segment);
    normalized.push(createTextSegment(""));
  }

  if (normalized.length === 0) {
    return createEmptyComposerDraft();
  }

  if (normalized[0]?.kind !== "text") {
    normalized.unshift(createTextSegment(""));
  }
  if (normalized[normalized.length - 1]?.kind !== "text") {
    normalized.push(createTextSegment(""));
  }

  return {
    segments: normalized,
  };
};

export const updateTextSegmentInDraft = (
  draft: AgentChatComposerDraft,
  segmentId: string,
  text: string,
): AgentChatComposerDraft => ({
  segments: draft.segments.map((segment) =>
    segment.kind === "text" && segment.id === segmentId ? { ...segment, text } : segment,
  ),
});

export const removeSlashCommandSegmentFromDraft = (
  draft: AgentChatComposerDraft,
  segmentId: string,
): {
  draft: AgentChatComposerDraft;
  focusSegmentId: string;
  focusOffset: number;
} | null => {
  const index = draft.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0 || draft.segments[index]?.kind !== "slash_command") {
    return null;
  }

  const previous = draft.segments[index - 1];
  const next = draft.segments[index + 1];
  if (!previous || !next || previous.kind !== "text" || next.kind !== "text") {
    return null;
  }

  const mergedText = previous.text + next.text;
  const segments = draft.segments.slice();
  segments.splice(index - 1, 3, createTextSegment(mergedText, previous.id));

  return {
    draft: {
      segments,
    },
    focusSegmentId: previous.id,
    focusOffset: previous.text.length,
  };
};

export const replaceTextRangeWithSlashCommand = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  rangeStart: number,
  rangeEnd: number,
  command: AgentSlashCommand,
): {
  draft: AgentChatComposerDraft;
  focusSegmentId: string;
  focusOffset: number;
} | null => {
  const index = draft.segments.findIndex((segment) => segment.id === textSegmentId);
  const segment = draft.segments[index];
  if (index < 0 || !segment || segment.kind !== "text") {
    return null;
  }

  const beforeText = segment.text.slice(0, rangeStart);
  const afterText = segment.text.slice(rangeEnd);
  const afterSegment = createTextSegment(afterText);
  const replacement: AgentChatComposerSegment[] = [
    createTextSegment(beforeText, segment.id),
    createSlashCommandSegment(command),
    afterSegment,
  ];
  const segments = draft.segments.slice();
  segments.splice(index, 1, ...replacement);

  return {
    draft: {
      segments,
    },
    focusSegmentId: afterSegment.id,
    focusOffset: 0,
  };
};

export const draftToUserMessageParts = (draft: AgentChatComposerDraft): AgentUserMessagePart[] => {
  return normalizeComposerDraft(draft).segments.flatMap<AgentUserMessagePart>((segment) => {
    if (segment.kind === "text") {
      return segment.text.length > 0 ? [{ kind: "text", text: segment.text }] : [];
    }

    return [{ kind: "slash_command", command: segment.command }];
  });
};

export const draftToSerializedText = (draft: AgentChatComposerDraft): string => {
  return draftToUserMessageParts(draft)
    .map((part) => (part.kind === "text" ? part.text : `/${part.command.trigger}`))
    .join("");
};

export const draftHasMeaningfulContent = (draft: AgentChatComposerDraft): boolean => {
  return draftToUserMessageParts(draft).some(
    (part) => part.kind === "slash_command" || part.text.trim().length > 0,
  );
};

const SLASH_QUERY_ALLOWED_PATTERN = /^[a-zA-Z0-9._:-]*$/;
const isSlashBoundaryCharacter = (value: string | undefined): boolean => {
  return value === undefined || /[\s([{"'`]/.test(value);
};

export const readSlashTriggerMatch = (
  text: string,
  caretOffset: number,
): AgentChatSlashTriggerMatch | null => {
  const boundedOffset = Math.max(0, Math.min(text.length, caretOffset));
  const prefix = text.slice(0, boundedOffset);
  const slashIndex = prefix.lastIndexOf("/");
  if (slashIndex < 0) {
    return null;
  }

  const beforeSlash = prefix.slice(0, slashIndex);
  const previousCharacter = beforeSlash.length > 0 ? beforeSlash.at(-1) : undefined;
  if (!isSlashBoundaryCharacter(previousCharacter ?? undefined)) {
    return null;
  }

  const query = prefix.slice(slashIndex + 1);
  if (!SLASH_QUERY_ALLOWED_PATTERN.test(query)) {
    return null;
  }

  return {
    query,
    rangeStart: slashIndex,
    rangeEnd: boundedOffset,
  };
};
