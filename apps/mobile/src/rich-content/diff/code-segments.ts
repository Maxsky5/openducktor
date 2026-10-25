import type { HighlightedLine, HighlightTone } from "@/rich-content/code/highlight";

/** A range of characters in one line: `start` is inclusive and `end` exclusive. */
export type CharRange = { readonly start: number; readonly end: number };

/** A run of one syntax color. `emphasized` marks the changed words of a changed line. */
export type CodeSegment = {
  readonly text: string;
  readonly tone: HighlightTone;
  readonly emphasized: boolean;
};

/**
 * Splits highlighted tokens at the edges of `emphasis`, so the changed words can get their own
 * wash. Without a range, each token gives one segment.
 */
export const codeSegments = (
  tokens: HighlightedLine,
  emphasis: CharRange | null,
): CodeSegment[] => {
  const segments: CodeSegment[] = [];
  let offset = 0;
  for (const token of tokens) {
    const start = offset;
    const end = offset + token.text.length;
    offset = end;
    if (emphasis === null || emphasis.end <= start || emphasis.start >= end) {
      segments.push({ text: token.text, tone: token.tone, emphasized: false });
      continue;
    }
    const from = Math.max(emphasis.start, start) - start;
    const to = Math.min(emphasis.end, end) - start;
    if (from > 0) {
      segments.push({ text: token.text.slice(0, from), tone: token.tone, emphasized: false });
    }
    segments.push({ text: token.text.slice(from, to), tone: token.tone, emphasized: true });
    if (to < token.text.length) {
      segments.push({ text: token.text.slice(to), tone: token.tone, emphasized: false });
    }
  }
  return segments;
};

/** A changed part that covers more of the line than this share is a new line, not an edit. */
const MAX_EMPHASIS_SHARE = 0.7;

/**
 * The changed words of a removed line and the added line that replaces it: the text between
 * their shared start and their shared end. Returns null when the lines share too little to show
 * an edit, or when they are equal.
 */
export const changedRanges = (
  removed: string,
  added: string,
): { removed: CharRange; added: CharRange } | null => {
  const limit = Math.min(removed.length, added.length);
  let prefix = 0;
  while (prefix < limit && removed.charCodeAt(prefix) === added.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    removed.charCodeAt(removed.length - 1 - suffix) === added.charCodeAt(added.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  const removedRange = { start: prefix, end: removed.length - suffix };
  const addedRange = { start: prefix, end: added.length - suffix };
  if (removedRange.end <= removedRange.start && addedRange.end <= addedRange.start) return null;
  const shared = prefix + suffix;
  const longest = Math.max(removed.length, added.length);
  if (shared === 0 || (longest - shared) / longest > MAX_EMPHASIS_SHARE) return null;
  return { removed: removedRange, added: addedRange };
};
