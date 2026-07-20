import type { PullRequestReviewComment } from "@openducktor/contracts";
import { ChevronRight, ExternalLink, Lightbulb, MessageSquare } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactElement } from "react";
import { memo, useState } from "react";
import type { Components, ExtraProps } from "react-markdown";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { cn } from "@/lib/utils";
import { PierrePreloadedDiffViewer } from "./pierre-diff-viewer";
import { commentLocationLabel } from "./task-execution-ci-presentation";
import { TaskExecutionCiRelativeTime } from "./task-execution-ci-relative-time";

const openReviewUrl = (url: string, failureMessage: string): void => {
  void openExternalUrl(url).catch((error) => {
    toast.error(failureMessage, {
      description: errorMessage(error),
    });
  });
};

type TaskExecutionCiMarkdownLinkProps = ComponentProps<"a"> & ExtraProps;

export function TaskExecutionCiMarkdownLink({
  node: _node,
  children,
  className,
  href,
  ...props
}: TaskExecutionCiMarkdownLinkProps): ReactElement {
  const openLink = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    if (href) {
      openReviewUrl(href, "Failed to open link");
    }
  };
  const openLinkFromAuxiliaryClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button === 1) {
      openLink(event);
    }
  };
  return (
    <a
      {...props}
      href={href}
      target={undefined}
      onClick={openLink}
      onAuxClick={openLinkFromAuxiliaryClick}
      className={cn(
        "text-foreground underline decoration-muted-foreground underline-offset-2 transition hover:decoration-foreground",
        className,
      )}
    >
      {children}
    </a>
  );
}

const CI_COMMENT_MARKDOWN_COMPONENTS: Components = {
  a: TaskExecutionCiMarkdownLink,
};

function TaskExecutionCiSuggestedChange({
  patch,
  filePath,
  position,
  total,
}: {
  patch: string;
  filePath: string;
  position: number;
  total: number;
}): ReactElement {
  return (
    <section
      aria-label="Suggested change"
      className="min-w-0 border-info-border/70 border-t bg-info-surface/40 px-3 py-3"
      data-testid="ci-review-comment-suggestion-diff"
    >
      <div className="min-w-0 overflow-hidden rounded-md border border-info-border bg-card">
        <header className="flex h-8 items-center justify-between gap-2 border-info-border border-b bg-info-surface px-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Lightbulb className="size-3.5 shrink-0 text-info-muted" aria-hidden="true" />
            <h4 className="truncate text-xs font-semibold text-info-surface-foreground">
              Suggested change
            </h4>
          </div>
          {total > 1 ? (
            <span className="shrink-0 text-[10px] font-medium text-info-muted">
              {position} of {total}
            </span>
          ) : null}
        </header>
        <PierrePreloadedDiffViewer
          patch={patch}
          filePath={filePath}
          diffStyle="unified"
          diffIndicators="bars"
          lineOverflow="wrap"
          hunkSeparators="simple"
        />
      </div>
    </section>
  );
}

export const TaskExecutionCiCommentCard = memo(function TaskExecutionCiCommentCard({
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
  const filePath = comment.path;
  const hasBody = comment.body.trim().length > 0;
  const hasPatch = Boolean(comment.patch?.trim() && filePath);
  const hasSuggestionPatches = comment.suggestionPatches.length > 0 && filePath !== null;
  const [isOpen, setIsOpen] = useState(comment.isResolved !== true);

  const openComment = (): void => {
    if (!comment.url) {
      return;
    }
    openReviewUrl(comment.url, "Failed to open comment");
  };

  return (
    <article className="min-w-0 overflow-hidden rounded-md border border-border bg-card [--diffs-gap-block:0px]">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch">
        <button
          type="button"
          className="group/comment grid min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 text-left outline-none transition hover:bg-accent/40 focus-visible:bg-accent/50"
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Collapse" : "Expand"} comment from ${author}`}
          data-state={isOpen ? "open" : "closed"}
          onClick={() => {
            setIsOpen((current) => !current);
          }}
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
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
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/comment:rotate-90" />
        </button>
        {comment.url ? (
          <div className="flex items-center pr-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={openComment}
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                  aria-label={`Open comment from ${author}`}
                >
                  <ExternalLink className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Open comment</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </header>
      {isOpen ? (
        <div>
          {hasPatch && filePath && comment.patch ? (
            <div
              className="min-w-0 overflow-hidden border-t border-border bg-muted/20"
              data-testid="ci-review-comment-diff"
            >
              <PierrePreloadedDiffViewer
                patch={comment.patch}
                filePath={filePath}
                diffStyle="unified"
                diffIndicators="bars"
                lineOverflow="wrap"
                hunkSeparators="simple"
              />
            </div>
          ) : null}
          {hasBody ? (
            <div className="min-w-0 overflow-hidden border-t border-border px-3 py-1">
              <MarkdownRenderer
                markdown={comment.body}
                variant="compact"
                components={CI_COMMENT_MARKDOWN_COMPONENTS}
                className="min-w-0 break-words prose-p:break-words prose-li:break-words prose-code:break-words prose-pre:max-w-full prose-pre:whitespace-pre-wrap prose-pre:break-words prose-blockquote:break-words [&_pre_code]:whitespace-pre-wrap [&_pre_code]:break-words"
              />
            </div>
          ) : null}
          {hasSuggestionPatches && filePath
            ? comment.suggestionPatches.map((suggestionPatch, index) => (
                <TaskExecutionCiSuggestedChange
                  key={suggestionPatch}
                  patch={suggestionPatch}
                  filePath={filePath}
                  position={index + 1}
                  total={comment.suggestionPatches.length}
                />
              ))
            : null}
          {!hasBody && !hasPatch && !hasSuggestionPatches ? (
            <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">
              No comment body.
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
});
