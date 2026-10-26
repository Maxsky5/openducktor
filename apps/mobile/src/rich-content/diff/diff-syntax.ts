import {
  HIGHLIGHT_CHUNK_LINES,
  type HighlightedCode,
  type HighlightedLine,
  highlightLines,
  languageForFilePath,
} from "@/rich-content/code/highlight";
import type { DiffLineRow, DiffRow } from "./diff-row-model";

/**
 * Desktop highlights diffs up to this line count (`PIERRE_HIGHLIGHT_LINE_LIMIT`). A larger diff
 * shows plain text, so its highlight cost stays bounded.
 */
export const DIFF_HIGHLIGHT_LINE_LIMIT = 1000;

/** The syntax tokens of the lines of one file diff. */
export type DiffSyntax = {
  tokensFor(row: DiffLineRow): HighlightedLine | null;
  /** Highlights the next chunk that no row asked for yet. Returns false when all are ready. */
  warmNextChunk(): boolean;
};

type SideLine = { side: "old" | "new"; index: number };

/**
 * The syntax of a file diff. Each side of the diff highlights as one text, so a line keeps the
 * context of the lines above it, such as an open block comment. Highlighting runs per chunk on
 * the first request. Returns null for an unknown language or a diff over the line limit.
 */
export const createDiffSyntax = (rows: readonly DiffRow[], path: string): DiffSyntax | null => {
  const language = languageForFilePath(path);
  if (language === null) return null;
  const oldTexts: string[] = [];
  const newTexts: string[] = [];
  const sideLines = new Map<string, SideLine>();
  for (const row of rows) {
    if (row.kind !== "line") continue;
    if (row.change !== "add") {
      if (row.change === "delete") sideLines.set(row.key, { side: "old", index: oldTexts.length });
      oldTexts.push(row.text);
    }
    if (row.change !== "delete") {
      sideLines.set(row.key, { side: "new", index: newTexts.length });
      newTexts.push(row.text);
    }
  }
  if (sideLines.size === 0 || sideLines.size > DIFF_HIGHLIGHT_LINE_LIMIT) return null;
  let oldCode: HighlightedCode | null = null;
  let newCode: HighlightedCode | null = null;
  const code = (side: "old" | "new"): HighlightedCode => {
    if (side === "old") {
      oldCode ??= highlightLines(oldTexts.join("\n"), language);
      return oldCode;
    }
    newCode ??= highlightLines(newTexts.join("\n"), language);
    return newCode;
  };
  const chunkStarts: SideLine[] = [];
  for (const [side, texts] of [
    ["new", newTexts],
    ["old", oldTexts],
  ] as const) {
    for (let index = 0; index < texts.length; index += HIGHLIGHT_CHUNK_LINES) {
      chunkStarts.push({ side, index });
    }
  }
  let warmed = 0;
  return {
    tokensFor: (row) => {
      const line = sideLines.get(row.key);
      return line ? code(line.side).line(line.index) : null;
    },
    warmNextChunk: () => {
      const next = chunkStarts[warmed];
      if (next === undefined) return false;
      warmed += 1;
      code(next.side).line(next.index);
      return warmed < chunkStarts.length;
    },
  };
};
