import type { PullRequestReviewActivity } from "@openducktor/contracts";
import { ChevronRight, ListFilter, MessageSquare } from "lucide-react";
import type { ReactElement } from "react";
import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TaskExecutionCiCommentCard } from "./task-execution-ci-comment-card";
import {
  countPullRequestComments,
  filterPullRequestComments,
  PULL_REQUEST_COMMENT_FILTERS,
  type PullRequestCommentAuthorFilter,
  useHideResolvedComments,
} from "@openducktor/frontend-core/review/pull-request-comment-filters";
import { isBotCommentAuthor } from "@openducktor/frontend-core/review/task-execution-ci-presentation";

const COMMENT_BODY_BATCH_SIZE = 4;

type TaskExecutionCiCommentsListProps = {
  comments: PullRequestReviewActivity[];
};

const selectNextBodyBatchIds = (
  comments: readonly PullRequestReviewActivity[],
  readyBodyIds: ReadonlySet<string>,
): string[] => {
  const batchIds: string[] = [];
  for (const comment of comments) {
    if (comment.isResolved === true || readyBodyIds.has(comment.id)) {
      continue;
    }
    batchIds.push(comment.id);
    if (batchIds.length === COMMENT_BODY_BATCH_SIZE) {
      break;
    }
  }
  return batchIds;
};

export const TaskExecutionCiCommentsList = memo(function TaskExecutionCiCommentsList({
  comments,
}: TaskExecutionCiCommentsListProps): ReactElement {
  const [filter, setFilter] = useState<PullRequestCommentAuthorFilter>("all");
  const { hideResolved, setHideResolved } = useHideResolvedComments();
  const hideResolvedId = useId();
  const deferredComments = useDeferredValue(comments);
  const deferredFilter = useDeferredValue(filter);
  const deferredHideResolved = useDeferredValue(hideResolved);
  const counts = useMemo(
    () => countPullRequestComments(comments, hideResolved),
    [comments, hideResolved],
  );
  const visibleComments = useMemo(
    () => filterPullRequestComments(deferredComments, deferredFilter, deferredHideResolved),
    [deferredComments, deferredFilter, deferredHideResolved],
  );
  const [readyBodyIds, setReadyBodyIds] = useState<ReadonlySet<string>>(() => new Set());
  const nextBodyBatchIds = useMemo(
    () => selectNextBodyBatchIds(visibleComments, readyBodyIds),
    [readyBodyIds, visibleComments],
  );

  useEffect(() => {
    if (nextBodyBatchIds.length === 0) {
      return;
    }

    const frameId = globalThis.requestAnimationFrame(() => {
      startTransition(() => {
        setReadyBodyIds((current) => {
          const next = new Set(current);
          for (const id of nextBodyBatchIds) {
            next.add(id);
          }
          return next;
        });
      });
    });

    return () => {
      globalThis.cancelAnimationFrame(frameId);
    };
  }, [nextBodyBatchIds]);

  let filteredCommentsContent: ReactElement;
  if (visibleComments.length === 0) {
    filteredCommentsContent = (
      <div className="py-4 text-center text-sm text-muted-foreground">
        No comments for this filter.
      </div>
    );
  } else {
    filteredCommentsContent = (
      <div className="flex flex-col gap-2">
        {visibleComments.map((comment) => (
          <TaskExecutionCiCommentCard
            key={comment.id}
            comment={comment}
            isBot={isBotCommentAuthor(comment.author)}
            isBodyReady={readyBodyIds.has(comment.id)}
          />
        ))}
      </div>
    );
  }

  let commentsContent: ReactElement;
  if (comments.length === 0) {
    commentsContent = (
      <div className="px-4 py-4 text-sm text-muted-foreground">No comments reported.</div>
    );
  } else {
    commentsContent = (
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-3 rounded-md border border-border bg-muted/30 p-1">
            {PULL_REQUEST_COMMENT_FILTERS.map((item) => {
              const isActive = filter === item.id;
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 justify-center gap-1 rounded-sm px-2 hover:bg-foreground/5",
                    isActive && "bg-foreground/10 text-foreground shadow-sm hover:bg-foreground/15",
                  )}
                  aria-pressed={isActive}
                  onClick={() => {
                    setFilter(item.id);
                  }}
                >
                  <span>{item.label}</span>
                  <span className="tabular-nums">{counts[item.id]}</span>
                </Button>
              );
            })}
          </div>
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="Filter comments">
                    <ListFilter aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Filter comments</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-56 p-2">
              <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
                <label
                  htmlFor={hideResolvedId}
                  className="text-sm font-medium text-popover-foreground"
                >
                  Hide resolved
                </label>
                <Switch
                  id={hideResolvedId}
                  checked={hideResolved}
                  onCheckedChange={setHideResolved}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {filteredCommentsContent}
      </div>
    );
  }

  return (
    <details className="group/comments" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 outline-none transition hover:bg-accent/40 focus-visible:bg-accent/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/comments:rotate-90" />
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Comments</h3>
        <Badge variant="secondary" className="shrink-0">
          {comments.length}
        </Badge>
      </summary>
      <div className="border-t border-border">{commentsContent}</div>
    </details>
  );
});
