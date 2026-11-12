// The File Diff of one changed file in the mobile app, as file-diff-screen.tsx, file-diff-view.tsx,
// diff-comment-flow.tsx, and comment-composer.tsx in apps/mobile/src/features/review: the file
// name over its folder, the change and its line counts, the whole diff, and the bottom bar of the
// comment flow. A tap on a line selects it, and a tap on another line of the same side extends
// the range. The selection bar then names the lines and offers Comment, which opens the comment
// field. diff-comments.ts moves the flow.
import { ArrowUp, FilePlus, MessageSquarePlus, X } from "lucide-react";
import type { ReactElement } from "react";
import { type DiffComment, DiffLines, LineCounts } from "./DiffRows";
import { MobileScreen } from "./MobileScreen";
import { StackHeader } from "./StackHeader";
import "./DiffScreen.css";

/** The placeholder of the comment field when the Builder gets the comments. */
export const COMMENT_PLACEHOLDER = "Add a comment for the Builder";

type DiffScreenProps = {
  id: string;
  path: string;
  /** The lines of the added file, from line 1. */
  lines: readonly string[];
  comment: DiffComment;
  hidden?: boolean | undefined;
};

export function DiffScreen({ id, path, lines, comment, hidden }: DiffScreenProps): ReactElement {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  return (
    <MobileScreen id={id} over hidden={hidden} className="mob-review-page">
      <StackHeader title={name} subtitle={path.slice(0, slash)} />
      <div className="mob-file-diff">
        <div className="mob-file-diff-head">
          <FilePlus />
          <span>Added</span>
          <LineCounts add={lines.length} del={0} />
        </div>
        <DiffLines lines={lines} comment={comment} />
      </div>
      <div className="mob-selection-bar" data-selection-bar="" hidden>
        <span className="mob-selection-clear">
          <X />
        </span>
        <span className="mob-selection-text">
          <strong data-selection-label="" />
          <span>{name}</span>
        </span>
        <span className="mob-sm-button" data-comment-start="">
          <MessageSquarePlus />
          Comment
        </span>
      </div>
      <div className="mob-comment-composer" data-comment-composer="" hidden>
        <div className="mob-comment-context">
          <span data-composer-title="" />
          <strong>Cancel</strong>
        </div>
        <div className="mob-comment-field" data-comment-field="">
          <p>
            <span className="mob-comment-typed" data-comment-typed="" />
            <span className="mob-comment-hint">{COMMENT_PLACEHOLDER}</span>
          </p>
          <span className="mob-comment-save" data-comment-save="">
            <ArrowUp />
          </span>
        </div>
      </div>
    </MobileScreen>
  );
}
