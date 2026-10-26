import type { AgentFileSearchResultKind } from "@openducktor/core";
import {
  type AgentChatComposerDraft,
  type AgentChatComposerSegment,
  createTextSegment,
  normalizeComposerDraft,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { buildComposerTokens, type ComposerChipKind } from "./composer-segments";

/** One run of the text of the composer input: typed text, or the text that a chip pill covers. */
export type ComposerSpan =
  | { kind: "text"; segmentId: string; start: number; end: number; text: string }
  | {
      kind: "chip";
      segmentId: string;
      start: number;
      end: number;
      text: string;
      chip: ComposerChipKind;
      /** The pad before the label, which also holds the icon of the pill. */
      padStart: string;
      /** The label as the pill shows it, with no line break point inside. */
      label: string;
      fileKind: AgentFileSearchResultKind;
    };

/** The draft as the text of one native input, with the place of each text run and chip. */
export type ComposerLayout = { text: string; spans: ComposerSpan[] };

/** The caret in one text run of the draft. */
export type ComposerCaret = { segmentId: string; offset: number };

/**
 * The text of a chip in the input: a start margin, a start pad, the label, an end pad, and an
 * end margin. The field draws the pill over the pads and the label. The start margin and the pads
 * never break from their neighbors, so a chip never splits across two lines. The end margin is
 * two punctuation spaces: a line can break after them but not before them. A keyboard never types
 * a punctuation space, so the text change of a backspace after a chip always touches the chip,
 * also when the text after the chip starts with a space. In the 16-point text font, a figure
 * space is 9.9 points wide, as the 10-point desktop pill padding, and two punctuation spaces are
 * 8.1 points, as its 8-point end margin.
 */
export const CHIP_MARGIN_START = "\u00A0";
export const CHIP_PAD = "\u2007";
export const CHIP_MARGIN_END = "\u2008\u2008";
/** The start pad of a chip with an icon also holds the 14-point icon and its 6-point gap. */
const ICON_PAD = CHIP_PAD.repeat(3);

/** A word joiner between label characters, so a hyphen or a slash in a label never breaks a line. */
const NO_BREAK = "\u2060";

/** The longest label that a pill shows, as the desktop chip truncates a long name. */
const CHIP_LABEL_MAX_LENGTH = 32;

const pillLabel = (label: string): string => {
  const shown =
    label.length > CHIP_LABEL_MAX_LENGTH ? `${label.slice(0, CHIP_LABEL_MAX_LENGTH - 1)}…` : label;
  return Array.from(shown).join(NO_BREAK);
};

/**
 * The composer draft as the text of one multiline input. Text runs show as typed, and each chip
 * shows as the label of its desktop pill, such as `/review` or `lint`. Text after a chip then
 * flows on the same line and wraps below it, as in the desktop editor.
 */
export const layoutComposerDraft = (draft: AgentChatComposerDraft): ComposerLayout => {
  let position = 0;
  const spans = buildComposerTokens(draft).map((token): ComposerSpan => {
    const start = position;
    if (token.kind === "text") {
      position += token.text.length;
      return { kind: "text", segmentId: token.segmentId, start, end: position, text: token.text };
    }
    const label = pillLabel(token.label);
    // A Slash Command pill has no icon.
    const padStart = token.chip === "slash_command" ? CHIP_PAD : ICON_PAD;
    const text = `${CHIP_MARGIN_START}${padStart}${label}${CHIP_PAD}${CHIP_MARGIN_END}`;
    position += text.length;
    return {
      kind: "chip",
      segmentId: token.segmentId,
      start,
      end: position,
      text,
      chip: token.chip,
      padStart,
      label,
      fileKind: token.fileKind,
    };
  });
  return { text: spans.map((span) => span.text).join(""), spans };
};

/** The chip that a caret falls inside, or null for a caret in a text run or at a chip edge. */
export const chipAtPosition = (
  layout: ComposerLayout,
  position: number,
): Extract<ComposerSpan, { kind: "chip" }> | null =>
  layout.spans.find(
    (span): span is Extract<ComposerSpan, { kind: "chip" }> =>
      span.kind === "chip" && position > span.start && position < span.end,
  ) ?? null;

/** The text run and offset of a caret in the input text. A caret inside a chip has none. */
export const caretInLayout = (layout: ComposerLayout, position: number): ComposerCaret | null => {
  for (const span of layout.spans) {
    if (span.kind === "text" && position >= span.start && position <= span.end) {
      return { segmentId: span.segmentId, offset: position - span.start };
    }
  }
  return null;
};

/** The position in the input text of a caret in one text run. */
export const positionInLayout = (layout: ComposerLayout, caret: ComposerCaret): number => {
  const span = layout.spans.find((entry) => entry.segmentId === caret.segmentId);
  return span ? span.start + Math.min(caret.offset, span.end - span.start) : layout.text.length;
};

export type ComposerTextChange = {
  draft: AgentChatComposerDraft;
  /** The text of the input for the new draft. It differs from the typed text after a chip edit. */
  text: string;
  /** The caret in the new text. */
  caret: number;
};

/**
 * Applies a change of the input text to the draft. A chip is one unit, as on desktop: a deletion
 * that touches it removes the whole chip, and text typed inside it goes after it.
 */
export const applyComposerTextChange = (
  draft: AgentChatComposerDraft,
  nextText: string,
): ComposerTextChange => {
  const layout = layoutComposerDraft(draft);
  const base = layout.text;
  let prefix = 0;
  while (prefix < base.length && prefix < nextText.length && base[prefix] === nextText[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < nextText.length - prefix &&
    base[base.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removedStart = prefix;
  const removedEnd = base.length - suffix;
  const inserted = nextText.slice(prefix, nextText.length - suffix);
  const removes = removedEnd > removedStart;

  const before: AgentChatComposerSegment[] = [];
  const after: AgentChatComposerSegment[] = [];
  for (const [index, span] of layout.spans.entries()) {
    const segment = draft.segments[index];
    if (!segment) continue;
    const insidePoint = !removes && span.start < removedStart && removedStart < span.end;
    if (span.end <= removedStart || (span.kind === "chip" && insidePoint)) {
      before.push(segment);
    } else if (span.start >= removedEnd && !insidePoint) {
      after.push(segment);
    } else if (span.kind === "text") {
      const kept = span.text.slice(0, Math.max(0, removedStart - span.start));
      const rest = span.text.slice(Math.max(0, removedEnd - span.start));
      if (kept.length > 0) before.push(createTextSegment(kept, span.segmentId));
      if (rest.length > 0) after.push(createTextSegment(rest));
    }
    // A chip that the change touches goes, with all of its text.
  }
  const head = layoutComposerDraft({ segments: before, attachments: [] }).text.length;
  const next = normalizeComposerDraft({
    ...draft,
    segments: [...before, createTextSegment(inserted), ...after],
  });
  return { draft: next, text: layoutComposerDraft(next).text, caret: head + inserted.length };
};
