import type { AgentSessionUserMessagePart } from "@openducktor/contracts";
import type { AgentUserMessageDisplayPart } from "@openducktor/core";
import type { AgentChatMessage } from "../../types/agent-orchestrator";

const USER_MESSAGE_REFERENCE_KINDS = [
  "file_reference",
  "skill_mention",
  "subagent_reference",
] as const;

export type UserMessageReferenceKind = (typeof USER_MESSAGE_REFERENCE_KINDS)[number];

const referenceKinds: ReadonlySet<string> = new Set(USER_MESSAGE_REFERENCE_KINDS);

/** A file, skill, or subagent reference in a user message. */
export type UserMessageReferencePart = Extract<
  AgentSessionUserMessagePart,
  { kind: UserMessageReferenceKind }
>;

/** Tells if a part of a user message shows as a reference chip. */
export const isUserMessageReferencePart = <Part extends { kind: string }>(
  part: Part,
): part is Extract<Part, { kind: UserMessageReferenceKind }> => referenceKinds.has(part.kind);

type DisplayReferencePart = Extract<
  AgentUserMessageDisplayPart,
  { kind: UserMessageReferenceKind }
>;

export type UserAttachmentPart = Extract<AgentUserMessageDisplayPart, { kind: "attachment" }>;

/** One piece of a user message: plain text, or a reference that shows as a chip. */
export type UserMessageContentNode =
  | { kind: "text"; key: string; text: string }
  | { kind: "reference"; key: string; part: DisplayReferencePart };

export type UserMessageContent = {
  /** The text and reference chips in reading order, or null when the message has no text. */
  nodes: UserMessageContentNode[] | null;
  attachments: UserAttachmentPart[];
  /** True while the host queues the message and the agent has not read it. */
  isUnread: boolean;
};

type InlineReferenceRange = { part: DisplayReferencePart; start: number; end: number };

const readVisibleText = (parts: readonly AgentUserMessageDisplayPart[]): string => {
  let text = "";
  for (const part of parts) {
    if (part.kind === "text" && !part.synthetic) text += part.text;
  }
  return text;
};

const readRenderableText = (
  parts: readonly AgentUserMessageDisplayPart[],
  fallbackText: string,
): string => {
  if (parts.some((part) => isUserMessageReferencePart(part) && part.sourceText)) {
    return fallbackText;
  }
  const visibleText = readVisibleText(parts);
  return visibleText.length > 0 ? visibleText : fallbackText;
};

const textContainsReferenceMarker = (text: string, part: DisplayReferencePart): boolean => {
  if (part.kind === "skill_mention") return text.includes(`$${part.skill.name}`);
  if (part.kind === "subagent_reference") return text.includes(`@${part.subagent.name}`);
  return text.includes(`@${part.file.path}`) || text.includes(`@${part.file.name}`);
};

const canUseOrderedParts = (parts: readonly AgentUserMessageDisplayPart[]): boolean => {
  const visibleText = readVisibleText(parts);
  if (visibleText.length === 0) return false;
  let hasReference = false;
  for (const part of parts) {
    if (!isUserMessageReferencePart(part)) continue;
    hasReference = true;
    if (part.sourceText || textContainsReferenceMarker(visibleText, part)) return false;
  }
  return hasReference;
};

const pushText = (nodes: UserMessageContentNode[], text: string, key: string): void => {
  if (text.length > 0) nodes.push({ kind: "text", key, text });
};

const buildOrderedNodes = (
  parts: readonly AgentUserMessageDisplayPart[],
): UserMessageContentNode[] | null => {
  if (!canUseOrderedParts(parts)) return null;
  const nodes: UserMessageContentNode[] = [];
  const occurrences = new Map<string, number>();
  const nextKey = (base: string): string => {
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return `${base}-${occurrence}`;
  };
  for (const part of parts) {
    if (part.kind === "text" && !part.synthetic) {
      pushText(nodes, part.text, nextKey("text"));
      continue;
    }
    if (isUserMessageReferencePart(part)) {
      nodes.push({ kind: "reference", key: nextKey(`reference-${part.kind}`), part });
    }
  }
  return nodes.length > 0 ? nodes : null;
};

const readInlineRanges = (
  rawText: string,
  parts: readonly AgentUserMessageDisplayPart[],
): InlineReferenceRange[] => {
  const ranges: InlineReferenceRange[] = [];
  for (const part of parts) {
    if (!isUserMessageReferencePart(part)) continue;
    const sourceText = part.sourceText;
    if (!sourceText) {
      const marker =
        part.kind === "skill_mention"
          ? `$${part.skill.name}`
          : part.kind === "subagent_reference"
            ? `@${part.subagent.name}`
            : null;
      if (marker !== null) {
        const start = rawText.indexOf(marker);
        if (start >= 0) ranges.push({ part, start, end: start + marker.length });
      }
      continue;
    }
    const { start, end } = sourceText;
    if (start >= 0 && end >= start && end <= rawText.length) ranges.push({ part, start, end });
  }
  return ranges.toSorted((left, right) => left.start - right.start);
};

/**
 * Builds the text and reference chips of a user message. The keys stay the same when the
 * message renders again, so a client can use them as element keys.
 */
const buildUserMessageContentNodes = (
  rawText: string,
  parts: readonly AgentUserMessageDisplayPart[],
): UserMessageContentNode[] | null => {
  const ordered = buildOrderedNodes(parts);
  if (ordered) return ordered;

  const nodes: UserMessageContentNode[] = [];
  const inlineRanges = readInlineRanges(rawText, parts);
  const renderedInline = new Set<AgentUserMessageDisplayPart>();
  if (inlineRanges.length === 0) {
    pushText(nodes, rawText, "text");
  } else {
    let cursor = 0;
    for (const range of inlineRanges) {
      if (range.start < cursor || range.start > rawText.length || range.end > rawText.length) {
        continue;
      }
      pushText(nodes, rawText.slice(cursor, range.start), `text-${cursor}`);
      nodes.push({ kind: "reference", key: `reference-${range.start}`, part: range.part });
      renderedInline.add(range.part);
      cursor = range.end;
    }
    pushText(nodes, rawText.slice(cursor), `text-${cursor}`);
  }

  // Inline keys use text offsets, so the trailing chips count in their own key space.
  let trailingIndex = 0;
  for (const part of parts) {
    if (
      !isUserMessageReferencePart(part) ||
      renderedInline.has(part) ||
      ((part.kind === "skill_mention" || part.kind === "subagent_reference") &&
        !part.sourceText &&
        textContainsReferenceMarker(rawText, part))
    ) {
      continue;
    }
    nodes.push({ kind: "reference", key: `trailing-reference-${trailingIndex}`, part });
    trailingIndex += 1;
  }
  return nodes.length > 0 ? nodes : null;
};

const isAttachmentPart = (part: AgentUserMessageDisplayPart): part is UserAttachmentPart =>
  part.kind === "attachment";

const readUserMessageParts = (message: AgentChatMessage): AgentUserMessageDisplayPart[] =>
  message.meta?.kind === "user" ? (message.meta.parts ?? []) : [];

/** The text of a user message as the chat shows it, without the reference chips. */
export const readUserMessageText = (message: AgentChatMessage): string =>
  readRenderableText(readUserMessageParts(message), message.content);

/** The parts with their visible text cut at `end`. Text that starts at `end` or later goes. */
const withVisibleTextEndingAt = (
  parts: AgentUserMessageDisplayPart[],
  end: number,
): AgentUserMessageDisplayPart[] => {
  let offset = 0;
  return parts.flatMap((part) => {
    if (part.kind !== "text" || part.synthetic) return [part];
    const start = offset;
    offset += part.text.length;
    if (start >= end) return [];
    return [{ ...part, text: part.text.slice(0, end - start).trimEnd() }];
  });
};

/**
 * The text, reference chips, attachments, and queue state of a user message. A `textEnd` from
 * `readUserMessageText` cuts the text there, so the client can show the rest in another way.
 */
export const buildUserMessageContent = (
  message: AgentChatMessage,
  textEnd: number | null = null,
): UserMessageContent => {
  const meta = message.meta?.kind === "user" ? message.meta : null;
  const allParts = readUserMessageParts(message);
  const text = readRenderableText(allParts, message.content);
  const parts = textEnd === null ? allParts : withVisibleTextEndingAt(allParts, textEnd);
  return {
    nodes: buildUserMessageContentNodes(
      textEnd === null ? text : text.slice(0, textEnd).trimEnd(),
      parts,
    ),
    attachments: allParts.filter(isAttachmentPart),
    isUnread: meta?.state === "queued",
  };
};

const USER_MESSAGE_SUMMARY_MAX_LENGTH = 120;

/**
 * The start of the first line of a user message as plain text, for an accessible name. A message
 * without text names its attachments, and an empty message gives an empty string.
 */
export const readUserMessageSummary = (message: AgentChatMessage): string => {
  const parts = readUserMessageParts(message);
  const firstLine = readRenderableText(parts, message.content)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    const names = parts.filter(isAttachmentPart).map((part) => part.attachment.name);
    return names.length > 0 ? `Attachments: ${names.join(", ")}` : "";
  }
  return firstLine.length > USER_MESSAGE_SUMMARY_MAX_LENGTH
    ? `${firstLine.slice(0, USER_MESSAGE_SUMMARY_MAX_LENGTH)}…`
    : firstLine;
};

/** The plain text of a reference chip, for screen readers and compact rows. */
export const userMessageReferenceLabel = (part: UserMessageReferencePart): string => {
  if (part.kind === "skill_mention") return `$${part.skill.name}`;
  if (part.kind === "subagent_reference") return `@${part.subagent.name}`;
  return part.file.name;
};
