/**
 * Splits a long Markdown text into chunks at blank lines between top-level blocks, so a list can
 * show a long message as several rows and parse only the rows that it renders. Each chunk parses
 * to the same blocks as its part of the whole text:
 *
 * - A chunk starts only on a complete line that follows a blank line, outside fenced code and
 *   math, and that cannot continue the block before the blank line: indented content, a list
 *   item, a quote, a table row, or raw HTML.
 * - A text with link or footnote definitions stays whole, because a definition changes references
 *   in other blocks. So does a text with raw HTML that can hold blank lines.
 */
export type MarkdownChunk = {
  /** The offset of the chunk in the whole text. */
  readonly start: number;
  readonly text: string;
};

/** The chunks of a text, kept to split the next text of a stream from its last chunk. */
export type MarkdownChunks = {
  readonly markdown: string;
  readonly chunks: readonly MarkdownChunk[];
};

const FENCE = /^ {0,3}(`{3,}|~{3,}|\${2,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,}|\${2,})[ \t]*$/;
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/m;
const RAW_HTML_BLOCK = /^ {0,3}<(?:script|pre|style|textarea|!--|\?|![A-Za-z]|!\[CDATA\[)/im;
const CONTINUES_BLOCK = /^(?:[ \t]|[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|[>|<])/;

const keepsWhole = (text: string): boolean => DEFINITION.test(text) || RAW_HTML_BLOCK.test(text);

const closesFence = (line: string, fence: string): boolean => {
  const closing = CLOSING_FENCE.exec(line)?.[1];
  return closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length;
};

/** The chunks of `markdown` from `from`, where a chunk starts outside any fence. */
const splitFrom = (markdown: string, from: number, size: number): MarkdownChunk[] => {
  const chunks: MarkdownChunk[] = [];
  let chunkStart = from;
  let fence: string | null = null;
  let afterBlank = false;
  let lineStart = from;
  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    // The last line can still grow while text streams, so no chunk starts on it.
    if (newline === -1) break;
    const line = markdown.slice(lineStart, newline);
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
    } else if (line.trim() === "") {
      afterBlank = true;
    } else {
      if (afterBlank && lineStart - chunkStart >= size && !CONTINUES_BLOCK.test(line)) {
        chunks.push({ start: chunkStart, text: markdown.slice(chunkStart, lineStart) });
        chunkStart = lineStart;
      }
      afterBlank = false;
      fence = FENCE.exec(line)?.[1] ?? null;
    }
    lineStart = newline + 1;
  }
  chunks.push({ start: chunkStart, text: markdown.slice(chunkStart) });
  return chunks;
};

/**
 * The chunks of `markdown`, each at least `size` characters long except the last one. Pass the
 * chunks of the text before it while it streams: a text that grows at its end keeps the earlier
 * chunks and splits again only from its last chunk.
 */
export const splitMarkdownChunks = (
  markdown: string,
  size: number,
  previous: MarkdownChunks | null = null,
): MarkdownChunks => {
  if (previous?.markdown === markdown) return previous;
  const kept = previous !== null && markdown.startsWith(previous.markdown) ? previous.chunks : null;
  const last = kept?.at(-1);
  if (kept === null || last === undefined || kept.length === 1) {
    const chunks = keepsWhole(markdown)
      ? [{ start: 0, text: markdown }]
      : splitFrom(markdown, 0, size);
    return { markdown, chunks };
  }
  // The earlier chunks have no definitions, so only the text from the last chunk can add one.
  if (keepsWhole(markdown.slice(last.start))) {
    return { markdown, chunks: [{ start: 0, text: markdown }] };
  }
  return { markdown, chunks: [...kept.slice(0, -1), ...splitFrom(markdown, last.start, size)] };
};
