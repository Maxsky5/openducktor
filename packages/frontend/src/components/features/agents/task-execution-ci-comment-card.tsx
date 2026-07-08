import type { PullRequestReviewComment } from "@openducktor/contracts";
import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { sourceLabel } from "./task-execution-ci-presentation";
import { TaskExecutionCiTimestampLine } from "./task-execution-ci-timestamp-line";

export function TaskExecutionCiCommentCard({
  comment,
}: {
  comment: PullRequestReviewComment;
}): ReactElement {
  const showThreadBadge = comment.isResolved !== null;

  return (
    <article className="space-y-2 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{comment.author ?? "Unknown author"}</div>
          {comment.path ? (
            <div className="truncate text-xs text-muted-foreground">
              {comment.path}
              {comment.line ? `:${comment.line}` : ""}
            </div>
          ) : null}
        </div>
        {showThreadBadge ? (
          <Badge variant={comment.isResolved === true ? "success" : "warning"} className="shrink-0">
            {comment.isResolved === true ? "Resolved" : "Unresolved"}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{sourceLabel(comment.source)}</span>
        {comment.threadId ? <span title={`Thread ${comment.threadId}`}>Thread</span> : null}
        {comment.createdAt ? (
          <TaskExecutionCiTimestampLine label="Created" timestamp={comment.createdAt} />
        ) : null}
        {comment.updatedAt ? (
          <TaskExecutionCiTimestampLine label="Updated" timestamp={comment.updatedAt} />
        ) : null}
      </div>
      {comment.body.trim().length > 0 ? (
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{comment.body}</p>
      ) : (
        <p className="text-sm text-muted-foreground">No comment body.</p>
      )}
      {comment.url ? (
        <a
          href={comment.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Open comment
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </article>
  );
}
