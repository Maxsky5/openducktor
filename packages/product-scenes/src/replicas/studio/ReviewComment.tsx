// An inline review comment under a diff line, from file-diff-comments.tsx. Without `text` it is the
// form of a new comment, which a scene types into. With `text` it is the saved comment, which
// waits for the next message. The Trash2 icon of the product is Trash in Lucide 1.
import { Check, Pencil, Trash } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import "./ReviewComment.css";

function CommentForm(): ReactElement {
  return (
    <>
      <div
        className="st-textarea typed"
        data-placeholder="Add a comment for the Builder"
        data-comment-text=""
      />
      <div className="st-comment-actions">
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Button size="sm" data-disabled data-comment-save>
          <Check />
          Comment
        </Button>
      </div>
    </>
  );
}

function SavedComment({ text }: { text: string }): ReactElement {
  return (
    <>
      <p>{text}</p>
      <div className="st-comment-actions" data-saved="">
        <Button variant="outline" size="icon">
          <Pencil />
        </Button>
        <Button variant="destructive" size="icon">
          <Trash />
        </Button>
      </div>
    </>
  );
}

export function ReviewComment({ text }: { text?: string }): ReactElement {
  return (
    <div className="st-comment" data-comment="">
      <div>
        <span className="st-badge">Pending</span>
        {text === undefined ? <CommentForm /> : <SavedComment text={text} />}
      </div>
    </div>
  );
}
