import type { PullRequestReviewComment } from "@openducktor/contracts";
import { ExternalLink, MessageSquare } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { commentLocationLabel, sourceLabel } from "./task-execution-ci-presentation";
import { TaskExecutionCiTimestampLine } from "./task-execution-ci-timestamp-line";

export function TaskExecutionCiCommentCard({
  comment,
  isBot,
}: {
  comment: PullRequestReviewComment;
  isBot: boolean;
}): ReactElement {
  const showThreadBadge = comment.isResolved !== null;
  const location = commentLocationLabel(comment);

  return (
    <article className="overflow-hidden rounded-md border border-border bg-card">
      <header className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 gap-2">
          <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageSquare className="size-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {comment.author ?? "Unknown author"}
              </span>
              {isBot ? (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  Bot
                </Badge>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{sourceLabel(comment.source)}</span>
              {location ? <span className="min-w-0 truncate">{location}</span> : null}
              {comment.createdAt ? (
                <TaskExecutionCiTimestampLine label="Created" timestamp={comment.createdAt} />
              ) : null}
            </div>
          </div>
        </div>
        {showThreadBadge ? (
          <Badge variant={comment.isResolved === true ? "success" : "warning"} className="shrink-0">
            {comment.isResolved === true ? "Resolved" : "Unresolved"}
          </Badge>
        ) : null}
      </header>
      {comment.body.trim().length > 0 ? (
        <div className="border-t border-border px-3 py-2.5">
          <MarkdownRenderer markdown={comment.body} variant="compact" />
        </div>
      ) : (
        <p className="border-t border-border px-3 py-2.5 text-sm text-muted-foreground">
          No comment body.
        </p>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {comment.threadId ? (
            <span title={`Thread ${comment.threadId}`}>Thread {comment.threadId}</span>
          ) : null}
          {comment.updatedAt ? (
            <TaskExecutionCiTimestampLine label="Updated" timestamp={comment.updatedAt} />
          ) : null}
        </div>
        {comment.url ? (
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
          >
            Open comment
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </footer>
    </article>
  );
}
