import type {
  AgentAttachmentKind,
  AgentFileReference,
  AgentSkillReference,
  AgentSlashCommand,
  AgentUserMessagePart,
} from "@openducktor/core";
import { serializeAgentUserMessagePartsToText } from "@openducktor/core";

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

export type AgentChatComposerFileReferenceSegment = {
  id: string;
  kind: "file_reference";
  file: AgentFileReference;
};

export type AgentChatComposerSkillReferenceSegment = {
  id: string;
  kind: "skill_mention";
  skill: AgentSkillReference;
};

export type AgentChatComposerSegment =
  | AgentChatComposerTextSegment
  | AgentChatComposerSlashCommandSegment
  | AgentChatComposerFileReferenceSegment
  | AgentChatComposerSkillReferenceSegment;

export type AgentChatComposerAttachment = {
  id: string;
  name: string;
  kind: AgentAttachmentKind;
  mime?: string;
  path?: string;
  file?: File;
  previewUrl?: string;
};

export type AgentChatComposerDraft = {
  segments: AgentChatComposerSegment[];
  attachments?: AgentChatComposerAttachment[];
};

export type AgentChatSlashTriggerMatch = {
  query: string;
  rangeStart: number;
  rangeEnd: number;
};

export type AgentChatFileTriggerMatch = {
  query: string;
  rangeStart: number;
  rangeEnd: number;
};

export type AgentChatSkillTriggerMatch = {
  query: string;
  rangeStart: number;
  rangeEnd: number;
};
type AgentChatTriggerMatch = AgentChatSkillTriggerMatch;

const hasExistingSlashCommandSegment = (draft: AgentChatComposerDraft): boolean => {
  return draft.segments.some((segment) => segment.kind === "slash_command");
};

const hasMeaningfulContentBeforeSegment = (
  draft: AgentChatComposerDraft,
  segmentIndex: number,
): boolean => {
  return draft.segments.slice(0, segmentIndex).some((segment) => {
    if (segment.kind === "text") {
      return segment.text.trim().length > 0;
    }

    return true;
  });
};

export type AgentChatComposerFocusTarget = {
  segmentId: string;
  offset: number;
};

export type AgentChatComposerDraftEdit =
  | {
      type: "update_text";
      segmentId: string;
      text: string;
      caretOffset?: number | null;
    }
  | {
      type: "insert_newline";
      segmentId: string;
      caretOffset: number;
    }
  | {
      type: "insert_slash_command";
      textSegmentId: string;
      rangeStart: number;
      rangeEnd: number;
      command: AgentSlashCommand;
    }
  | {
      type: "insert_file_reference";
      textSegmentId: string;
      rangeStart: number;
      rangeEnd: number;
      file: AgentFileReference;
    }
  | {
      type: "insert_skill_reference";
      textSegmentId: string;
      rangeStart: number;
      rangeEnd: number;
      skill: AgentSkillReference;
    }
  | {
      type: "remove_slash_command";
      segmentId: string;
    }
  | {
      type: "remove_file_reference";
      segmentId: string;
    }
  | {
      type: "remove_skill_reference";
      segmentId: string;
    }
  | {
      type: "remove_segment_range";
      startTextSegmentId: string;
      startOffset: number;
      endTextSegmentId: string;
      endOffset: number;
    };

export type AgentChatComposerDraftEditResult = {
  draft: AgentChatComposerDraft;
  focusTarget: AgentChatComposerFocusTarget | null;
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

export const createFileReferenceSegment = (
  file: AgentFileReference,
  id = createSegmentId(),
): AgentChatComposerFileReferenceSegment => ({
  id,
  kind: "file_reference",
  file,
});

export const createSkillReferenceSegment = (
  skill: AgentSkillReference,
  id = createSegmentId(),
): AgentChatComposerSkillReferenceSegment => ({
  id,
  kind: "skill_mention",
  skill,
});

export const createComposerAttachment = (
  attachment: Omit<AgentChatComposerAttachment, "id">,
  id = createSegmentId(),
): AgentChatComposerAttachment => ({
  id,
  ...attachment,
});

export const createEmptyComposerDraft = (): AgentChatComposerDraft => ({
  segments: [createTextSegment("")],
  attachments: [],
});

export const isTextSegment = (
  segment: AgentChatComposerSegment,
): segment is AgentChatComposerTextSegment => segment.kind === "text";

export const findTextSegment = (
  draft: AgentChatComposerDraft,
  segmentId: string,
): AgentChatComposerTextSegment | null => {
  for (const segment of draft.segments) {
    if (segment.kind === "text" && segment.id === segmentId) {
      return segment;
    }
  }

  return null;
};

export const normalizeComposerDraft = (draft: AgentChatComposerDraft): AgentChatComposerDraft => {
  const normalized: AgentChatComposerSegment[] = [];

  for (const [index, segment] of draft.segments.entries()) {
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

    const nextSegment = draft.segments[index + 1];
    if (nextSegment?.kind !== "text") {
      normalized.push(createTextSegment(""));
    }
  }

  if (normalized.length === 0) {
    return {
      ...createEmptyComposerDraft(),
      attachments: draft.attachments ?? [],
    };
  }

  if (normalized[0]?.kind !== "text") {
    normalized.unshift(createTextSegment(""));
  }
  if (normalized[normalized.length - 1]?.kind !== "text") {
    normalized.push(createTextSegment(""));
  }

  return {
    segments: normalized,
    attachments: draft.attachments ?? [],
  };
};

const withDraftSegments = (
  draft: AgentChatComposerDraft,
  segments: AgentChatComposerSegment[],
): AgentChatComposerDraft => ({
  ...draft,
  segments,
});

export const updateTextSegmentInDraft = (
  draft: AgentChatComposerDraft,
  segmentId: string,
  text: string,
): AgentChatComposerDraft => ({
  ...draft,
  segments: draft.segments.map((segment) =>
    segment.kind === "text" && segment.id === segmentId ? { ...segment, text } : segment,
  ),
});

const insertNewlineInTextSegment = (
  draft: AgentChatComposerDraft,
  segmentId: string,
  caretOffset: number,
): AgentChatComposerDraftEditResult | null => {
  const segment = draft.segments.find((entry) => entry.id === segmentId);
  if (segment?.kind !== "text") {
    return null;
  }

  const boundedOffset = Math.max(0, Math.min(caretOffset, segment.text.length));
  const nextText = `${segment.text.slice(0, boundedOffset)}\n${segment.text.slice(boundedOffset)}`;
  return {
    draft: updateTextSegmentInDraft(draft, segmentId, nextText),
    focusTarget: {
      segmentId,
      offset: boundedOffset + 1,
    },
  };
};

const removeNonTextSegmentFromDraft = (
  draft: AgentChatComposerDraft,
  segmentId: string,
  expectedKind: AgentChatComposerSegment["kind"],
): AgentChatComposerDraftEditResult | null => {
  const index = draft.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0 || draft.segments[index]?.kind !== expectedKind) {
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
    draft: withDraftSegments(draft, segments),
    focusTarget: {
      segmentId: previous.id,
      offset: previous.text.length,
    },
  };
};

export const removeSlashCommandSegmentFromDraft = (
  draft: AgentChatComposerDraft,
  segmentId: string,
): AgentChatComposerDraftEditResult | null => {
  return removeNonTextSegmentFromDraft(draft, segmentId, "slash_command");
};

export const removeFileReferenceSegmentFromDraft = (
  draft: AgentChatComposerDraft,
  segmentId: string,
): AgentChatComposerDraftEditResult | null => {
  return removeNonTextSegmentFromDraft(draft, segmentId, "file_reference");
};

export const removeSkillReferenceSegmentFromDraft = (
  draft: AgentChatComposerDraft,
  segmentId: string,
): AgentChatComposerDraftEditResult | null => {
  return removeNonTextSegmentFromDraft(draft, segmentId, "skill_mention");
};

const removeSegmentRangeFromDraft = (
  draft: AgentChatComposerDraft,
  startTextSegmentId: string,
  startOffset: number,
  endTextSegmentId: string,
  endOffset: number,
): AgentChatComposerDraftEditResult | null => {
  const startIndex = draft.segments.findIndex((segment) => segment.id === startTextSegmentId);
  const endIndex = draft.segments.findIndex((segment) => segment.id === endTextSegmentId);
  const startSegment = draft.segments[startIndex];
  const endSegment = draft.segments[endIndex];
  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    startSegment?.kind !== "text" ||
    endSegment?.kind !== "text"
  ) {
    return null;
  }

  const boundedStartOffset = Math.max(0, Math.min(startOffset, startSegment.text.length));
  const boundedEndOffset = Math.max(0, Math.min(endOffset, endSegment.text.length));
  if (startIndex === endIndex && boundedStartOffset >= boundedEndOffset) {
    return null;
  }

  const mergedText = `${startSegment.text.slice(0, boundedStartOffset)}${endSegment.text.slice(
    boundedEndOffset,
  )}`;
  const segments = draft.segments.slice();
  segments.splice(
    startIndex,
    endIndex - startIndex + 1,
    createTextSegment(mergedText, startSegment.id),
  );

  return {
    draft: withDraftSegments(draft, segments),
    focusTarget: {
      segmentId: startSegment.id,
      offset: boundedStartOffset,
    },
  };
};

const replaceTextRangeWithSegment = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  rangeStart: number,
  rangeEnd: number,
  replacementSegment: AgentChatComposerSegment,
): AgentChatComposerDraftEditResult | null => {
  const index = draft.segments.findIndex((segment) => segment.id === textSegmentId);
  const segment = draft.segments[index];
  if (index < 0 || !segment || segment.kind !== "text") {
    return null;
  }
  if (rangeStart < 0 || rangeEnd < rangeStart || rangeEnd > segment.text.length) {
    return null;
  }

  const afterSegment = createTextSegment(segment.text.slice(rangeEnd));
  const segments = draft.segments.slice();
  segments.splice(
    index,
    1,
    createTextSegment(segment.text.slice(0, rangeStart), segment.id),
    replacementSegment,
    afterSegment,
  );

  return {
    draft: withDraftSegments(draft, segments),
    focusTarget: {
      segmentId: afterSegment.id,
      offset: 0,
    },
  };
};

export const replaceTextRangeWithSlashCommand = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  rangeStart: number,
  rangeEnd: number,
  command: AgentSlashCommand,
): AgentChatComposerDraftEditResult | null => {
  const index = draft.segments.findIndex((segment) => segment.id === textSegmentId);
  const segment = draft.segments[index];
  if (index < 0 || !segment || segment.kind !== "text") {
    return null;
  }
  if (hasExistingSlashCommandSegment(draft)) {
    return null;
  }
  if (hasMeaningfulContentBeforeSegment(draft, index)) {
    return null;
  }
  if (segment.text.slice(0, rangeStart).trim().length > 0) {
    return null;
  }

  return replaceTextRangeWithSegment(
    draft,
    textSegmentId,
    rangeStart,
    rangeEnd,
    createSlashCommandSegment(command),
  );
};

export const replaceTextRangeWithFileReference = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  rangeStart: number,
  rangeEnd: number,
  file: AgentFileReference,
): AgentChatComposerDraftEditResult | null => {
  return replaceTextRangeWithSegment(
    draft,
    textSegmentId,
    rangeStart,
    rangeEnd,
    createFileReferenceSegment(file),
  );
};

export const replaceTextRangeWithSkillReference = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  rangeStart: number,
  rangeEnd: number,
  skill: AgentSkillReference,
): AgentChatComposerDraftEditResult | null => {
  return replaceTextRangeWithSegment(
    draft,
    textSegmentId,
    rangeStart,
    rangeEnd,
    createSkillReferenceSegment(skill),
  );
};

export const applyComposerDraftEdit = (
  draft: AgentChatComposerDraft,
  edit: AgentChatComposerDraftEdit,
): AgentChatComposerDraftEditResult | null => {
  switch (edit.type) {
    case "update_text": {
      return {
        draft: updateTextSegmentInDraft(draft, edit.segmentId, edit.text),
        focusTarget:
          typeof edit.caretOffset === "number"
            ? {
                segmentId: edit.segmentId,
                offset: Math.max(0, Math.min(edit.caretOffset, edit.text.length)),
              }
            : null,
      };
    }
    case "insert_newline":
      return insertNewlineInTextSegment(draft, edit.segmentId, edit.caretOffset);
    case "insert_slash_command":
      return replaceTextRangeWithSlashCommand(
        draft,
        edit.textSegmentId,
        edit.rangeStart,
        edit.rangeEnd,
        edit.command,
      );
    case "insert_file_reference":
      return replaceTextRangeWithFileReference(
        draft,
        edit.textSegmentId,
        edit.rangeStart,
        edit.rangeEnd,
        edit.file,
      );
    case "insert_skill_reference":
      return replaceTextRangeWithSkillReference(
        draft,
        edit.textSegmentId,
        edit.rangeStart,
        edit.rangeEnd,
        edit.skill,
      );
    case "remove_slash_command":
      return removeSlashCommandSegmentFromDraft(draft, edit.segmentId);
    case "remove_file_reference":
      return removeFileReferenceSegmentFromDraft(draft, edit.segmentId);
    case "remove_skill_reference":
      return removeSkillReferenceSegmentFromDraft(draft, edit.segmentId);
    case "remove_segment_range":
      return removeSegmentRangeFromDraft(
        draft,
        edit.startTextSegmentId,
        edit.startOffset,
        edit.endTextSegmentId,
        edit.endOffset,
      );
  }
};

export const draftToUserMessageParts = (draft: AgentChatComposerDraft): AgentUserMessagePart[] => {
  const normalizedDraft = normalizeComposerDraft(draft);
  return [
    ...normalizedDraft.segments.flatMap<AgentUserMessagePart>((segment) => {
      if (segment.kind === "text") {
        return segment.text.length > 0 ? [{ kind: "text", text: segment.text }] : [];
      }

      if (segment.kind === "file_reference") {
        return [{ kind: "file_reference", file: segment.file }];
      }

      if (segment.kind === "skill_mention") {
        return [{ kind: "skill_mention", skill: segment.skill }];
      }

      return [{ kind: "slash_command", command: segment.command }];
    }),
    ...(normalizedDraft.attachments ?? []).flatMap<AgentUserMessagePart>((attachment) => {
      if (!attachment.path) {
        return [];
      }

      return [
        {
          kind: "attachment",
          attachment: {
            id: attachment.id,
            path: attachment.path,
            name: attachment.name,
            kind: attachment.kind,
            ...(attachment.mime ? { mime: attachment.mime } : {}),
          },
        },
      ];
    }),
  ];
};

export const resolveDraftToUserMessageParts = async (
  draft: AgentChatComposerDraft,
  resolveAttachmentPath: (attachment: AgentChatComposerAttachment) => Promise<string>,
): Promise<AgentUserMessagePart[]> => {
  const parts = draftToUserMessageParts({
    ...draft,
    attachments: [],
  });

  const attachmentParts = await Promise.all(
    (normalizeComposerDraft(draft).attachments ?? []).map(async (attachment) => {
      const path = attachment.file
        ? await resolveAttachmentPath(attachment)
        : (attachment.path ?? (await resolveAttachmentPath(attachment)));
      if (path.trim().length === 0) {
        throw new Error(`Attachment "${attachment.name}" is missing a local file path.`);
      }

      return {
        kind: "attachment" as const,
        attachment: {
          id: attachment.id,
          path,
          name: attachment.name,
          kind: attachment.kind,
          ...(attachment.mime ? { mime: attachment.mime } : {}),
        },
      } satisfies AgentUserMessagePart;
    }),
  );

  return [...parts, ...attachmentParts];
};

export const draftToSerializedText = (draft: AgentChatComposerDraft): string => {
  return serializeAgentUserMessagePartsToText(draftToUserMessageParts(draft));
};

export const draftHasMeaningfulContent = (draft: AgentChatComposerDraft): boolean => {
  if ((draft.attachments ?? []).length > 0) {
    return true;
  }

  return draftToUserMessageParts(draft).some((part) => {
    if (part.kind === "text") {
      return part.text.trim().length > 0;
    }
    return true;
  });
};

export const draftHasSlashCommandSegment = hasExistingSlashCommandSegment;

export const appendTextToDraft = (
  draft: AgentChatComposerDraft,
  appendedText: string,
): AgentChatComposerDraft => {
  if (appendedText.length === 0) {
    return draft;
  }

  const normalizedDraft = normalizeComposerDraft(draft);
  const lastSegment = normalizedDraft.segments[normalizedDraft.segments.length - 1];
  if (lastSegment?.kind !== "text") {
    throw new Error(
      "appendTextToDraft: normalizeComposerDraft invariant violated - last segment is not text.",
    );
  }

  const hasMeaningfulExistingContent = draftToSerializedText(normalizedDraft).trim().length > 0;
  const separator = hasMeaningfulExistingContent ? "\n\n" : "";
  return {
    ...normalizedDraft,
    segments: normalizedDraft.segments.map((segment, index) =>
      index === normalizedDraft.segments.length - 1 && segment.kind === "text"
        ? {
            ...segment,
            text: hasMeaningfulExistingContent
              ? `${segment.text}${separator}${appendedText}`
              : appendedText,
          }
        : segment,
    ),
  };
};

export const appendAttachmentsToDraft = (
  draft: AgentChatComposerDraft,
  attachments: AgentChatComposerAttachment[],
): AgentChatComposerDraft => ({
  ...draft,
  attachments: [...(draft.attachments ?? []), ...attachments],
});

export const removeAttachmentFromDraft = (
  draft: AgentChatComposerDraft,
  attachmentId: string,
): AgentChatComposerDraft => ({
  ...draft,
  attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId),
});

export const readSlashTriggerMatchForDraft = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  caretOffset: number,
  textOverride?: string,
): AgentChatSlashTriggerMatch | null => {
  if (hasExistingSlashCommandSegment(draft)) {
    return null;
  }

  const segmentIndex = draft.segments.findIndex((segment) => segment.id === textSegmentId);
  const segment = draft.segments[segmentIndex];
  if (segmentIndex < 0 || !segment || segment.kind !== "text") {
    return null;
  }

  if (hasMeaningfulContentBeforeSegment(draft, segmentIndex)) {
    return null;
  }

  const segmentText = textOverride ?? segment.text;
  const match = readSlashTriggerMatch(segmentText, caretOffset);
  if (!match) {
    return null;
  }

  if (segmentText.slice(0, match.rangeStart).trim().length > 0) {
    return null;
  }

  return match;
};

const SLASH_QUERY_ALLOWED_PATTERN = /^[a-zA-Z0-9._:-]*$/;
const SKILL_QUERY_ALLOWED_PATTERN = /^[a-zA-Z0-9._:-]*$/;
const FILE_QUERY_ALLOWED_PATTERN = /^[^\s)\]}",'`:;!?]*$/;

const isTriggerBoundaryCharacter = (value: string | undefined): boolean => {
  return value === undefined || /[\s([{"'`]/.test(value);
};

const readTriggerMatch = (
  text: string,
  caretOffset: number,
  trigger: string,
  allowedQueryPattern: RegExp,
): AgentChatTriggerMatch | null => {
  const boundedOffset = Math.max(0, Math.min(text.length, caretOffset));
  const prefix = text.slice(0, boundedOffset);
  const triggerIndex = prefix.lastIndexOf(trigger);
  if (triggerIndex < 0) {
    return null;
  }

  const beforeTrigger = prefix.slice(0, triggerIndex);
  const previousCharacter = beforeTrigger.length > 0 ? beforeTrigger.at(-1) : undefined;
  if (!isTriggerBoundaryCharacter(previousCharacter)) {
    return null;
  }

  const query = prefix.slice(triggerIndex + trigger.length);
  if (!allowedQueryPattern.test(query)) {
    return null;
  }

  return {
    query,
    rangeStart: triggerIndex,
    rangeEnd: boundedOffset,
  };
};

const textSegmentValueForTrigger = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  textOverride?: string,
): string | null => {
  const segment = draft.segments.find((entry) => entry.id === textSegmentId);
  if (segment?.kind !== "text") {
    return null;
  }

  return textOverride ?? segment.text;
};

export const readSlashTriggerMatch = (
  text: string,
  caretOffset: number,
): AgentChatSlashTriggerMatch | null => {
  return readTriggerMatch(text, caretOffset, "/", SLASH_QUERY_ALLOWED_PATTERN);
};

export const readFileTriggerMatchForDraft = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  caretOffset: number,
  textOverride?: string,
): AgentChatFileTriggerMatch | null => {
  const text = textSegmentValueForTrigger(draft, textSegmentId, textOverride);
  if (text === null) {
    return null;
  }

  return readFileTriggerMatch(text, caretOffset);
};

export const readSkillTriggerMatchForDraft = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  caretOffset: number,
  textOverride?: string,
): AgentChatSkillTriggerMatch | null => {
  const text = textSegmentValueForTrigger(draft, textSegmentId, textOverride);
  if (text === null) {
    return null;
  }

  return readSkillTriggerMatch(text, caretOffset);
};

export const readSkillTriggerMatch = (
  text: string,
  caretOffset: number,
): AgentChatSkillTriggerMatch | null => {
  return readTriggerMatch(text, caretOffset, "$", SKILL_QUERY_ALLOWED_PATTERN);
};

export const readFileTriggerMatch = (
  text: string,
  caretOffset: number,
): AgentChatFileTriggerMatch | null => {
  return readTriggerMatch(text, caretOffset, "@", FILE_QUERY_ALLOWED_PATTERN);
};
