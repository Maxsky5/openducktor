// The rows of a file diff in the mobile app, in the colors of the desktop @pierre/diffs view:
// diff-rows.tsx and pierre-colors.ts in apps/mobile/src/rich-content/diff, and
// diff-comment-view.tsx in apps/mobile/src/features/review. Each line wraps, keeps its number in
// `data-diff-line`, and shows the comment selection with `data-selected`. A pending Inline Diff
// Comment sits under its last line with the Pending badge, the line range, the text, and Edit and
// Remove.
import { Pencil, Trash2 } from "lucide-react";
import { Fragment, type ReactElement } from "react";
import { HighlightedCode } from "../studio/HighlightedCode";
import "./DiffRows.css";

/** The pending comment of a diff and the line that it sits under. */
export type DiffComment = { afterLine: number; range: string; text: string };

type DiffLinesProps = {
  /** The lines of an added file, from line 1. */
  lines: readonly string[];
  /** The pending comment, which a scene shows. */
  comment?: DiffComment;
};

/** The added and removed line counts. Zero counts stay hidden. */
export function LineCounts({ add, del }: { add: number; del: number }): ReactElement {
  return (
    <span className="mob-line-counts">
      {add > 0 && <span data-sign="add">+{add}</span>}
      {del > 0 && <span data-sign="del">-{del}</span>}
    </span>
  );
}

/** The added lines of a file, with the top gap of the first hunk. */
export function DiffLines({ lines, comment }: DiffLinesProps): ReactElement {
  return (
    <div className="mob-diff" data-diff="">
      <i className="mob-diff-gap" />
      {lines.map((line, index) => {
        const number = index + 1;
        return (
          // The lines of a file never change order, so the number is a stable key.
          <Fragment key={number}>
            <div className="mob-diff-line" data-diff-line={number}>
              <span className="mob-diff-number">{number}</span>
              <code className="mob-diff-code">
                <HighlightedCode line={line} />
              </code>
            </div>
            {comment?.afterLine === number && <CommentCard comment={comment} />}
          </Fragment>
        );
      })}
    </div>
  );
}

/** The pending comment card of diff-comment-view.tsx. */
function CommentCard({ comment }: { comment: DiffComment }): ReactElement {
  return (
    <div className="mob-diff-comment" data-diff-comment="" hidden>
      <div className="mob-diff-comment-card">
        <div className="mob-diff-comment-meta">
          <span className="mob-pending-badge">Pending</span>
          <span>{comment.range}</span>
        </div>
        <p className="mob-diff-comment-text">{comment.text}</p>
        <div className="mob-diff-comment-actions">
          <span data-variant="outline">
            <Pencil />
          </span>
          <span data-variant="destructive">
            <Trash2 />
          </span>
        </div>
      </div>
    </div>
  );
}
