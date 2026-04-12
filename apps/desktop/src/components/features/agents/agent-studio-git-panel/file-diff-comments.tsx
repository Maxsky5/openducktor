import { Check, ChevronDown, Pencil, Trash2, X } from "lucide-react";
import type { ReactElement } from "react";
import type { PierreDiffSelection } from "@/components/features/agents/pierre-diff-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import type { DiffScope } from "@/features/agent-studio-git";
import type { InlineCommentDraft } from "@/state/use-inline-comment-draft-store";
import { DIFF_SCOPE_OPTIONS } from "./constants";

const COMMENT_BODY_CLASS_NAME = "text-xs leading-5 text-foreground";

const getDiffScopeLabel = (diffScope: DiffScope): string => {
  return DIFF_SCOPE_OPTIONS.find((option) => option.scope === diffScope)?.label ?? diffScope;
};

const formatLineRange = (startLine: number, endLine: number): string => {
  return startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
};

const CommentMeta = ({
  diffScope,
  side,
  startLine,
  endLine,
  status,
}: {
  diffScope: DiffScope;
  side: InlineCommentDraft["side"];
  startLine: number;
  endLine: number;
  status: InlineCommentDraft["status"];
}): ReactElement => {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant={status === "sent" ? "outline" : "warning"}>
        {status === "sent" ? "Sent" : "Pending"}
      </Badge>
      {status === "submitting" ? <Badge variant="outline">Sending</Badge> : null}
    </div>
  );
};

export const NewCommentForm = ({
  diffScope,
  selection,
  value,
  onChange,
  onCancel,
  onSave,
}: {
  diffScope: DiffScope;
  selection: PierreDiffSelection;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}): ReactElement => {
  return (
    <section
      className="rounded-lg border border-border bg-card p-3"
      data-testid="agent-studio-git-new-comment-form"
    >
      <CommentMeta
        diffScope={diffScope}
        side={selection.side}
        startLine={selection.startLine}
        endLine={selection.endLine}
        status="pending"
      />
      <Textarea
        value={value}
        placeholder="Add a comment for the Builder"
        className="mt-3 min-h-24"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={value.trim().length === 0} onClick={onSave}>
          <Check className="size-4" />
          Comment
        </Button>
      </div>
    </section>
  );
};

export const DiffAnnotationShell = ({ children }: { children: ReactElement }): ReactElement => {
  return <div className="py-4 px-5">{children}</div>;
};

export const DraftCommentCard = ({
  comment,
  isEditing,
  editingText,
  onEditingTextChange,
  onStartEditing,
  onCancelEditing,
  onSaveEditing,
  onRemove,
}: {
  comment: InlineCommentDraft;
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (value: string) => void;
  onStartEditing: (comment: InlineCommentDraft) => void;
  onCancelEditing: () => void;
  onSaveEditing: () => void;
  onRemove: (commentId: string) => void;
}): ReactElement => {
  const isSubmitting = comment.status === "submitting";

  return (
    <div
      className="rounded-lg border border-border bg-card p-3"
      data-testid="agent-studio-git-pending-comment"
    >
      <CommentMeta
        diffScope={comment.diffScope}
        side={comment.side}
        startLine={comment.startLine}
        endLine={comment.endLine}
        status={comment.status}
      />
      {isEditing ? (
        <>
          <Textarea
            value={editingText}
            className="mt-3 min-h-24"
            disabled={isSubmitting}
            onChange={(event) => onEditingTextChange(event.currentTarget.value)}
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
              onClick={onSaveEditing}
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
              disabled={isSubmitting}
              onClick={() => onStartEditing(comment)}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
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

export const SentCommentCard = ({ comment }: { comment: InlineCommentDraft }): ReactElement => {
  return (
    <Collapsible defaultOpen={false}>
      <div className="rounded-lg border border-border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
            data-testid="agent-studio-git-sent-comment-trigger"
          >
            <div className="min-w-0">
              <CommentMeta
                diffScope={comment.diffScope}
                side={comment.side}
                startLine={comment.startLine}
                endLine={comment.endLine}
                status="sent"
              />
              <p className={`mt-2 truncate ${COMMENT_BODY_CLASS_NAME}`}>{comment.text}</p>
            </div>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border px-3 py-3">
          <p className={`whitespace-pre-wrap ${COMMENT_BODY_CLASS_NAME}`}>{comment.text}</p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
