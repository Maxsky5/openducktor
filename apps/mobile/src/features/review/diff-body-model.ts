import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { type DiffRow, diffRowType } from "@/rich-content/diff/diff-row-model";
import { placeDiffComments } from "./diff-comment-model";
import type { PreparedFileDiff } from "./prepared-diff";

/**
 * One row of a file diff body in a list: a diff row, a pending comment card, the note above the
 * comments whose lines changed, the link to the full diff, the text for a diff without text
 * lines, and the bottom edge of the body.
 */
export type DiffBodyRow =
  | { kind: "diff"; key: string; fileKey: string; row: DiffRow }
  | { kind: "comment"; key: string; fileKey: string; commentId: string }
  | { kind: "unplaced"; key: string; fileKey: string }
  | { kind: "more"; key: string; fileKey: string; hiddenLines: number }
  | { kind: "no-text"; key: string; fileKey: string; message: string }
  | { kind: "end"; key: string; fileKey: string };

/**
 * An inline diff in the changed file list shows this many rows. A longer diff ends with a link to
 * the File Diff screen, so the next files stay a short scroll away.
 */
export const INLINE_DIFF_ROW_LIMIT = 400;

/**
 * The body rows of a file diff, with each pending comment under its last line. Comments whose
 * lines the diff no longer shows come first, under a note, as on desktop. Keys start with
 * `fileKey`, so the bodies of several files can share one list.
 */
export const buildDiffBody = ({
  fileKey,
  path,
  prepared,
  comments,
  rowLimit,
  withEnd,
}: {
  fileKey: string;
  path: string;
  prepared: PreparedFileDiff;
  comments: readonly InlineCommentDraft[];
  /** The rows to show before the link to the full diff, or null for all rows. */
  rowLimit: number | null;
  /** True to close the body with its bottom edge, as in the changed file list. */
  withEnd: boolean;
}): DiffBodyRow[] => {
  const body: DiffBodyRow[] = [];
  const placed = placeDiffComments(prepared.rows, comments);
  if (placed.unplaced.length > 0) {
    body.push({ kind: "unplaced", key: `${fileKey}|unplaced`, fileKey });
    for (const comment of placed.unplaced) {
      body.push({
        kind: "comment",
        key: `${fileKey}|comment:${comment.id}`,
        fileKey,
        commentId: comment.id,
      });
    }
  }
  if (prepared.rows.length === 0) {
    body.push({
      kind: "no-text",
      key: `${fileKey}|no-text`,
      fileKey,
      message: noTextMessage(prepared, path),
    });
  }
  const shown =
    rowLimit === null || placed.rows.length <= rowLimit
      ? placed.rows
      : placed.rows.slice(0, rowLimit);
  for (const row of shown) {
    body.push(
      row.kind === "comment"
        ? { kind: "comment", key: `${fileKey}|${row.key}`, fileKey, commentId: row.commentId }
        : { kind: "diff", key: `${fileKey}|${row.key}`, fileKey, row },
    );
  }
  if (shown.length < placed.rows.length) {
    const hiddenLines = placed.rows
      .slice(shown.length)
      .reduce((count, row) => (row.kind === "line" ? count + 1 : count), 0);
    body.push({ kind: "more", key: `${fileKey}|more`, fileKey, hiddenLines });
  }
  if (withEnd) body.push({ kind: "end", key: `${fileKey}|end`, fileKey });
  return body;
};

/** The text of a diff without rows: an empty file, a change Git shows no line of, or no text. */
const noTextMessage = (prepared: PreparedFileDiff, path: string): string => {
  if (prepared.emptyFile === "added") return "The new file is empty.";
  if (prepared.emptyFile === "deleted") return "The deleted file was empty.";
  return prepared.hasText
    ? "This diff has no part that shows for this file."
    : `No diff content available for ${path}`;
};

/** For `FlashList` `getItemType`: line rows of each change share recycled views. */
export const diffBodyRowType = (row: DiffBodyRow): string =>
  row.kind === "diff" ? diffRowType(row.row) : row.kind;
