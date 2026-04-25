import { Check, Pencil, Trash2 } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { InlineCommentDraft } from "@/state/use-inline-comment-draft-store";

const COMMENT_BODY_CLASS_NAME = "text-xs leading-5 text-foreground";

const CommentMeta = ({ status }: { status: InlineCommentDraft["status"] }): ReactElement => {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="warning">Pending</Badge>
      {status === "submitting" ? <Badge variant="outline">Sending</Badge> : null}
    </div>
  );
};

export const NewCommentForm = ({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (value: string) => void;
}): ReactElement => {
  const [draftText, setDraftText] = useState("");

  return (
    <section
      className="rounded-lg border border-border bg-card p-3"
      data-testid="agent-studio-git-new-comment-form"
    >
      <CommentMeta status="pending" />
      <Textarea
        value={draftText}
        placeholder="Add a comment for the Builder"
        className="mt-3 min-h-24"
        onChange={(event) => setDraftText(event.currentTarget.value)}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={draftText.trim().length === 0}
          onClick={() => onSave(draftText)}
        >
          <Check className="size-4" />
          Comment
        </Button>
      </div>
    </section>
  );
};

export const DiffAnnotationShell = ({ children }: { children: ReactElement }): ReactElement => {
  return <div className="py-2 px-4">{children}</div>;
};

export const DraftCommentCard = ({
  comment,
  isEditing,
  onStartEditing,
  onCancelEditing,
  onSaveEditing,
  onRemove,
}: {
  comment: InlineCommentDraft;
  isEditing: boolean;
  onStartEditing: (comment: InlineCommentDraft) => void;
  onCancelEditing: () => void;
  onSaveEditing: (commentId: string, text: string) => void;
  onRemove: (commentId: string) => void;
}): ReactElement => {
  const isSubmitting = comment.status === "submitting";
  const [editingText, setEditingText] = useState(comment.text);

  useEffect(() => {
    if (isEditing) {
      setEditingText(comment.text);
    }
  }, [comment.text, isEditing]);

  return (
    <div
      className="rounded-lg border border-border bg-card p-3"
      data-testid="agent-studio-git-pending-comment"
    >
      <CommentMeta status={comment.status} />
      {isEditing ? (
        <>
          <Textarea
            value={editingText}
            className="mt-3 min-h-24"
            disabled={isSubmitting}
            onChange={(event) => setEditingText(event.currentTarget.value)}
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={onCancelEditing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting || editingText.trim().length === 0}
              onClick={() => onSaveEditing(comment.id, editingText)}
            >
              <Check className="size-4" />
              Save
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={`mt-3 whitespace-pre-wrap ${COMMENT_BODY_CLASS_NAME}`}>{comment.text}</p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Edit"
              title="Edit"
              disabled={isSubmitting}
              onClick={() => onStartEditing(comment)}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              aria-label="Remove"
              title="Remove"
              disabled={isSubmitting}
              onClick={() => onRemove(comment.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
