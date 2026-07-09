import type { PullRequestReviewComment } from "@openducktor/contracts";
import { ExternalLink, MessageSquare } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PierreDiffViewer } from "./pierre-diff-viewer";
import { commentLocationLabel } from "./task-execution-ci-presentation";
import { TaskExecutionCiRelativeTime } from "./task-execution-ci-relative-time";

export function TaskExecutionCiCommentCard({
  comment,
  isBot,
}: {
  comment: PullRequestReviewComment;
  isBot: boolean;
}): ReactElement {
  const showThreadBadge = comment.isResolved !== null;
  const location = commentLocationLabel(comment);
  const author = comment.author ?? "Unknown author";
  const activityTimestamp = comment.createdAt ?? comment.updatedAt;
  const hasBody = comment.body.trim().length > 0;
  const hasPatch = Boolean(comment.patch?.trim() && comment.path);

  return (
    <article className="min-w-0 overflow-hidden rounded-md border border-border bg-card">
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 px-3 py-2">
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MessageSquare className="size-3.5" />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{author}</span>
            {isBot ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                Bot
              </Badge>
            ) : null}
            {activityTimestamp ? (
              <span className="text-[11px] text-muted-foreground">
                <TaskExecutionCiRelativeTime timestamp={activityTimestamp} />
              </span>
            ) : null}
            {showThreadBadge ? (
              <Badge
                variant={comment.isResolved === true ? "success" : "warning"}
                className="px-2 py-0 text-[10px]"
              >
                {comment.isResolved === true ? "Resolved" : "Unresolved"}
              </Badge>
            ) : null}
          </div>
          {location ? (
            <div
              className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
              title={location}
            >
              {location}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center">
          {comment.url ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={comment.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                  aria-label={`Open comment from ${author}`}
                >
                  <ExternalLink className="size-3.5" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="bottom">Open comment</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>
      {hasBody ? (
        <div className="min-w-0 overflow-hidden border-t border-border px-3 py-3">
          <MarkdownRenderer
            markdown={comment.body}
            variant="compact"
            className="min-w-0 break-words prose-p:break-words prose-li:break-words prose-code:break-words prose-pre:max-w-full prose-pre:whitespace-pre-wrap prose-pre:break-words prose-blockquote:break-words [&_pre_code]:whitespace-pre-wrap [&_pre_code]:break-words"
          />
        </div>
      ) : null}
      {hasPatch && comment.path && comment.patch ? (
        <div
          className="min-w-0 overflow-hidden border-t border-border bg-muted/20"
          data-testid="ci-review-comment-diff"
        >
          <PierreDiffViewer
            patch={comment.patch}
            filePath={comment.path}
            diffStyle="unified"
            diffIndicators="bars"
            lineOverflow="wrap"
            hunkSeparators="line-info"
          />
        </div>
      ) : null}
      {!hasBody && !hasPatch ? (
        <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
          No comment body.
        </p>
      ) : null}
    </article>
  );
}
