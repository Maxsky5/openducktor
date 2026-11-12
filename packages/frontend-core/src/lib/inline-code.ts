/** A part of a message: plain text, or a code value that the message puts between backticks. */
export type InlineCodePart = { text: string; code: boolean; start: number };

const CODE_SPAN_PATTERN = /`([^`]+)`/g;

/** Splits a message into its plain text and the values between backticks, such as `gh auth login`. */
export const splitInlineCode = (text: string): InlineCodePart[] => {
  const parts: InlineCodePart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CODE_SPAN_PATTERN)) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index), code: false, start: cursor });
    }
    parts.push({ text: match[1] ?? "", code: true, start: match.index });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), code: false, start: cursor });
  return parts;
};

/** The text of a message without its code backticks, for a screen reader announcement. */
export const inlineCodePlainText = (text: string): string =>
  splitInlineCode(text)
    .map((part) => part.text)
    .join("");
