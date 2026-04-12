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

const COMMENT_CONTEXT_PREVIEW_CLASS_NAME =
  "overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-5 text-foreground";
const COMMENT_ANNOTATION_SHELL_CLASS_NAME = "max-w-[95%] py-4 pl-5 sm:max-w-[70%]";

const getDiffScopeLabel = (diffScope: DiffScope): string => {
  return DIFF_SCOPE_OPTIONS.find((option) => option.scope === diffScope)?.label ?? diffScope;
};

const formatLineRange = (startLine: number, endLine: number): string => {
  return startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
};

const CommentContextPreview = ({
  comment,
}: {
  comment: Pick<InlineCommentDraft, "codeContext">;
}): ReactElement => {
  return (
    <pre className={COMMENT_CONTEXT_PREVIEW_CLASS_NAME}>
      {comment.codeContext
        .map(({ lineNumber, text, isSelected }) => {
          const marker = isSelected ? ">" : " ";
          return `${marker} ${String(lineNumber).padStart(4, " ")} | ${text}`;
        })
        .join("\n")}
    </pre>
  );
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
      <span>{getDiffScopeLabel(diffScope)}</span>
      <span>{side === "old" ? "Old side" : "New side"}</span>
      <span>{formatLineRange(startLine, endLine)}</span>
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
      <div className="mt-3">
        <CommentContextPreview comment={{ codeContext: selection.codeContext }} />
      </div>
      <Textarea
        value={value}
        placeholder="Add a comment for the Builder"
        className="mt-3 min-h-24"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="mr-1.5 size-3.5" />
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={value.trim().length === 0} onClick={onSave}>
          <Check className="mr-1.5 size-3.5" />
          Comment
        </Button>
      </div>
    </section>
  );
};

export const DiffAnnotationShell = ({ children }: { children: ReactElement }): ReactElement => {
  return <div className={COMMENT_ANNOTATION_SHELL_CLASS_NAME}>{children}</div>;
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
      <div className="mt-3">
        <CommentContextPreview comment={comment} />
      </div>
      {isEditing ? (
        <>
          <Textarea
            value={editingText}
            className="mt-3 min-h-24"
            disabled={isSubmitting}
            onChange={(event) => onEditingTextChange(event.currentTarget.value)}
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSubmitting}
              onClick={onCancelEditing}
            >
              <X className="mr-1.5 size-3.5" />
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting || editingText.trim().length === 0}
              onClick={onSaveEditing}
            >
              <Check className="mr-1.5 size-3.5" />
              Save
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{comment.text}</p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSubmitting}
              onClick={() => onStartEditing(comment)}
            >
              <Pencil className="mr-1.5 size-3.5" />
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSubmitting}
              onClick={() => onRemove(comment.id)}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Remove
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
              <p className="mt-1 truncate text-sm text-foreground">{comment.text}</p>
            </div>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border px-3 py-3">
          <div>
            <CommentContextPreview comment={comment} />
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{comment.text}</p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
