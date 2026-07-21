import type { PullRequestReviewComment } from "@openducktor/contracts";
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
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { TaskExecutionCiCommentCard } from "./task-execution-ci-comment-card";
import {
  persistTaskExecutionCiCommentFilters,
  readTaskExecutionCiCommentFilters,
} from "./task-execution-ci-comment-filters";
import { isBotCommentAuthor } from "./task-execution-ci-presentation";

type CommentFilter = "all" | "humans" | "bots";

const COMMENT_FILTERS: Array<{ id: CommentFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "humans", label: "Humans" },
  { id: "bots", label: "Bots" },
];

const COMMENT_BODY_BATCH_SIZE = 4;

type TaskExecutionCiCommentsListProps = {
  comments: PullRequestReviewComment[];
};

const commentTimestamp = (comment: PullRequestReviewComment): number => {
  const timestamp = Date.parse(comment.createdAt ?? comment.updatedAt ?? "");
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
};

const filterComments = (
  comments: readonly PullRequestReviewComment[],
  filter: CommentFilter,
  hideResolved: boolean,
): PullRequestReviewComment[] => {
  const commentsByResolution = hideResolved
    ? comments.filter((comment) => comment.isResolved !== true)
    : comments;
  let commentsByAuthor = commentsByResolution;
  if (filter !== "all") {
    commentsByAuthor = commentsByResolution.filter((comment) => {
      const isBot = isBotCommentAuthor(comment.author);
      if (filter === "bots") {
        return isBot;
      }
      return !isBot;
    });
  }
  return commentsByAuthor.toSorted(
    (left, right) => commentTimestamp(right) - commentTimestamp(left),
  );
};

const selectNextBodyBatchIds = (
  comments: readonly PullRequestReviewComment[],
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
  const [filter, setFilter] = useState<CommentFilter>("all");
  const [commentFilters, setCommentFilters] = useState(readTaskExecutionCiCommentFilters);
  const hideResolvedId = useId();
  const deferredComments = useDeferredValue(comments);
  const deferredFilter = useDeferredValue(filter);
  const deferredHideResolved = useDeferredValue(commentFilters.hideResolved);
  const countableComments = useMemo(
    () =>
      commentFilters.hideResolved
        ? comments.filter((comment) => comment.isResolved !== true)
        : comments,
    [commentFilters.hideResolved, comments],
  );
  const counts = useMemo(
    () => ({
      all: countableComments.length,
      bots: countableComments.filter((comment) => isBotCommentAuthor(comment.author)).length,
      humans: countableComments.filter((comment) => !isBotCommentAuthor(comment.author)).length,
    }),
    [countableComments],
  );
  const visibleComments = useMemo(
    () => filterComments(deferredComments, deferredFilter, deferredHideResolved),
    [deferredComments, deferredFilter, deferredHideResolved],
  );
  const [readyBodyIds, setReadyBodyIds] = useState<ReadonlySet<string>>(() => new Set());
  const nextBodyBatchIds = useMemo(
    () => selectNextBodyBatchIds(visibleComments, readyBodyIds),
    [readyBodyIds, visibleComments],
  );

  useEffect(() => {
    const currentCommentIds = new Set(comments.map((comment) => comment.id));
    setReadyBodyIds((current) => {
      if (current.size === 0) {
        return current;
      }
      const retainedIds = new Set<string>();
      for (const id of current) {
        if (currentCommentIds.has(id)) {
          retainedIds.add(id);
        }
      }
      return retainedIds.size === current.size ? current : retainedIds;
    });
  }, [comments]);

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

  const updateHideResolved = (hideResolved: boolean): void => {
    const nextFilters = { hideResolved };
    try {
      persistTaskExecutionCiCommentFilters(nextFilters);
      setCommentFilters(nextFilters);
    } catch (error) {
      toast.error("Failed to save comment filters", {
        description: errorMessage(error),
      });
    }
  };

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
            {COMMENT_FILTERS.map((item) => {
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
                  checked={commentFilters.hideResolved}
                  onCheckedChange={updateHideResolved}
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
