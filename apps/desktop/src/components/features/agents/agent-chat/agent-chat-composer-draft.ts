import type {
  AgentAttachmentKind,
  AgentFileReference,
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

export type AgentChatComposerSegment =
  | AgentChatComposerTextSegment
  | AgentChatComposerSlashCommandSegment
  | AgentChatComposerFileReferenceSegment;

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
      type: "remove_slash_command";
      segmentId: string;
    }
  | {
      type: "remove_file_reference";
      segmentId: string;
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
    if (!nextSegment || nextSegment.kind !== "text") {
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
  if (!segment || segment.kind !== "text") {
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
    draft: withDraftSegments(draft, segments),
    focusTarget: {
      segmentId: afterSegment.id,
      offset: 0,
    },
  };
};

export const replaceTextRangeWithFileReference = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  rangeStart: number,
  rangeEnd: number,
  file: AgentFileReference,
): AgentChatComposerDraftEditResult | null => {
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
    createFileReferenceSegment(file),
    afterSegment,
  ];
  const segments = draft.segments.slice();
  segments.splice(index, 1, ...replacement);

  return {
    draft: withDraftSegments(draft, segments),
    focusTarget: {
      segmentId: afterSegment.id,
      offset: 0,
    },
  };
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
    case "remove_slash_command":
      return removeSlashCommandSegmentFromDraft(draft, edit.segmentId);
    case "remove_file_reference":
      return removeFileReferenceSegmentFromDraft(draft, edit.segmentId);
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
  if (!lastSegment || lastSegment.kind !== "text") {
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
const FILE_QUERY_ALLOWED_PATTERN = /^[^\s)\]}",'`:;!?]*$/;

const isTriggerBoundaryCharacter = (value: string | undefined): boolean => {
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
  if (!isTriggerBoundaryCharacter(previousCharacter ?? undefined)) {
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

export const readFileTriggerMatchForDraft = (
  draft: AgentChatComposerDraft,
  textSegmentId: string,
  caretOffset: number,
  textOverride?: string,
): AgentChatFileTriggerMatch | null => {
  const segment = draft.segments.find((entry) => entry.id === textSegmentId);
  if (!segment || segment.kind !== "text") {
    return null;
  }

  return readFileTriggerMatch(textOverride ?? segment.text, caretOffset);
};

export const readFileTriggerMatch = (
  text: string,
  caretOffset: number,
): AgentChatFileTriggerMatch | null => {
  const boundedOffset = Math.max(0, Math.min(text.length, caretOffset));
  const prefix = text.slice(0, boundedOffset);
  const atIndex = prefix.lastIndexOf("@");
  if (atIndex < 0) {
    return null;
  }

  const beforeTrigger = prefix.slice(0, atIndex);
  const previousCharacter = beforeTrigger.length > 0 ? beforeTrigger.at(-1) : undefined;
  if (!isTriggerBoundaryCharacter(previousCharacter ?? undefined)) {
    return null;
  }

  const query = prefix.slice(atIndex + 1);
  if (!FILE_QUERY_ALLOWED_PATTERN.test(query)) {
    return null;
  }

  return {
    query,
    rangeStart: atIndex,
    rangeEnd: boundedOffset,
  };
};
