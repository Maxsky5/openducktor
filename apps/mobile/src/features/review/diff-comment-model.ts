import type {
  InlineCommentContextLine,
  InlineCommentDraft,
  InlineCommentSide,
} from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import {
  buildInlineCommentContext,
  type InlineCommentSideLine,
  inlineCommentMatchesLines,
} from "@openducktor/frontend-core/drafts/inline-comment-placement";
import type { DiffLineRow, DiffLineTarget, DiffRow } from "@/rich-content/diff/diff-row-model";

/** The lines that a new comment covers. All lines are on one side of the diff. */
export type DiffLineSelection = {
  side: InlineCommentSide;
  /** The first tapped line. A later tap extends the range from it. */
  anchor: number;
  startLine: number;
  endLine: number;
};

/**
 * The selection after a tap on a line. The first tap selects the line. A tap on another line of
 * the same side extends the range from the first line. A tap on the only selected line clears it.
 * A tap on the other side starts a new selection there.
 */
export const selectDiffLine = (
  selection: DiffLineSelection | null,
  target: DiffLineTarget,
): DiffLineSelection | null => {
  if (!selection || selection.side !== target.side) {
    return { side: target.side, anchor: target.line, startLine: target.line, endLine: target.line };
  }
  if (selection.startLine === selection.endLine && selection.startLine === target.line) return null;
  return {
    side: selection.side,
    anchor: selection.anchor,
    startLine: Math.min(selection.anchor, target.line),
    endLine: Math.max(selection.anchor, target.line),
  };
};

export const isLineSelected = (
  selection: DiffLineSelection | null,
  target: DiffLineTarget | null,
): boolean =>
  selection !== null &&
  target !== null &&
  selection.side === target.side &&
  target.line >= selection.startLine &&
  target.line <= selection.endLine;

const isLineRow = (row: DiffRow): row is DiffLineRow => row.kind === "line";

/** The lines of one side of the diff in order: context lines and the changes of that side. */
const sideLines = (rows: readonly DiffRow[], side: InlineCommentSide): InlineCommentSideLine[] => {
  const lines: InlineCommentSideLine[] = [];
  for (const row of rows) {
    if (!isLineRow(row)) continue;
    const lineNumber = side === "old" ? row.oldLine : row.newLine;
    if (lineNumber !== null) lines.push({ lineNumber, text: row.text });
  }
  return lines;
};

/**
 * The code context of a selection, with the context rule of desktop. Returns null when there are
 * no rows or the rows no longer show the selected lines.
 */
export const commentCodeContext = (
  rows: readonly DiffRow[] | null,
  selection: DiffLineSelection,
): InlineCommentContextLine[] | null =>
  rows
    ? buildInlineCommentContext(
        sideLines(rows, selection.side),
        selection.startLine,
        selection.endLine,
      )
    : null;

/**
 * True when the commented lines still hold the captured text on the same side of this diff. A
 * comment that fails this check must not attach to other content at the same line numbers.
 */
export const commentMatchesRows = (
  rows: readonly DiffRow[],
  comment: Pick<InlineCommentDraft, "side" | "startLine" | "endLine" | "codeContext">,
): boolean =>
  inlineCommentMatchesLines(
    new Map(sideLines(rows, comment.side).map((line) => [line.lineNumber, line.text])),
    comment,
  );

/** A pending comment below the last line that it covers. */
type DiffCommentRow = {
  kind: "comment";
  key: string;
  commentId: string;
};

type DiffListRow = DiffRow | DiffCommentRow;

/**
 * The list rows of a diff with each placed comment below its last line. Comments whose lines the
 * diff no longer shows stay pending and come back as `unplaced`.
 */
export type PlacedDiffComments = { rows: DiffListRow[]; unplaced: InlineCommentDraft[] };

export const placeDiffComments = (
  rows: readonly DiffRow[],
  comments: readonly InlineCommentDraft[],
): PlacedDiffComments => {
  const byAnchor = new Map<string, InlineCommentDraft[]>();
  const unplaced: InlineCommentDraft[] = [];
  for (const comment of comments) {
    if (!commentMatchesRows(rows, comment)) {
      unplaced.push(comment);
      continue;
    }
    const anchor = `${comment.side}:${comment.endLine}`;
    byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), comment]);
  }
  if (byAnchor.size === 0) return { rows: [...rows], unplaced };
  const listRows: DiffListRow[] = [];
  for (const row of rows) {
    listRows.push(row);
    if (!isLineRow(row)) continue;
    // A context line exists on both sides, so comments of either side can attach to it.
    for (const side of ["old", "new"] as const) {
      const line = side === "old" ? row.oldLine : row.newLine;
      if (line === null) continue;
      if (side === "old" && row.change === "add") continue;
      if (side === "new" && row.change === "delete") continue;
      const key = `${side}:${line}`;
      for (const comment of byAnchor.get(key) ?? []) {
        listRows.push({ kind: "comment", key: `comment:${comment.id}`, commentId: comment.id });
      }
      byAnchor.delete(key);
    }
  }
  return { rows: listRows, unplaced };
};

/** The accessible name of a line selection, such as "Lines 4 to 6, new side". */
export const selectionLabel = (selection: DiffLineSelection): string => {
  const side = selection.side === "old" ? "removed lines" : "new lines";
  return selection.startLine === selection.endLine
    ? `Line ${selection.startLine}, ${side}`
    : `Lines ${selection.startLine} to ${selection.endLine}, ${side}`;
};
