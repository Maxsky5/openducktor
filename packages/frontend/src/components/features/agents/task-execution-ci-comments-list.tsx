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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { TaskExecutionCiCommentCard } from "./task-execution-ci-comment-card";
import {
  persistTaskExecutionCiCommentFilters,
  readTaskExecutionCiCommentFilters,
} from "./task-execution-ci-comment-filters";
import { isBotCommentAuthor } from "./task-execution-ci-presentation";

type CommentFilter = "all" | "humans" | "bots";

type CommentGroup = {
  id: "all" | "conversation" | "needs-review" | "resolved";
  comments: PullRequestReviewComment[];
  title: string | null;
};

type CommentRenderProgress = {
  comments: readonly PullRequestReviewComment[];
  filter: CommentFilter;
  hideResolved: boolean;
  count: number;
};

const COMMENT_FILTERS: Array<{ id: CommentFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "humans", label: "Humans" },
  { id: "bots", label: "Bots" },
];

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
  if (filter === "all") {
    return commentsByResolution.toSorted(
      (left, right) => commentTimestamp(right) - commentTimestamp(left),
    );
  }
  return commentsByResolution.filter((comment) => {
    const isBot = isBotCommentAuthor(comment.author);
    return filter === "bots" ? isBot : !isBot;
  });
};

const groupComments = (comments: readonly PullRequestReviewComment[]): CommentGroup[] => {
  const needsReview = comments.filter((comment) => comment.isResolved === false);
  const conversation = comments.filter((comment) => comment.isResolved === null);
  const resolved = comments.filter((comment) => comment.isResolved === true);

  const groups: CommentGroup[] = [
    {
      id: "needs-review",
      title: `Needs review · ${needsReview.length}`,
      comments: needsReview,
    },
    {
      id: "conversation",
      title: `Conversation · ${conversation.length}`,
      comments: conversation,
    },
    { id: "resolved", title: `Resolved · ${resolved.length}`, comments: resolved },
  ];
  return groups.filter((group) => group.comments.length > 0);
};

const limitCommentGroups = (groups: CommentGroup[], limit: number): CommentGroup[] => {
  let remaining = limit;
  return groups.map((group) => {
    const comments = group.comments.slice(0, remaining);
    remaining -= comments.length;
    return { ...group, comments };
  });
};

export const TaskExecutionCiCommentsList = memo(function TaskExecutionCiCommentsList({
  comments,
}: {
  comments: PullRequestReviewComment[];
}): ReactElement {
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
  const commentGroups = useMemo<CommentGroup[]>(
    () =>
      deferredFilter === "all"
        ? [{ id: "all", title: null, comments: visibleComments }]
        : groupComments(visibleComments),
    [deferredFilter, visibleComments],
  );
  const [renderProgress, setRenderProgress] = useState<CommentRenderProgress>(() => ({
    comments: deferredComments,
    filter: deferredFilter,
    hideResolved: deferredHideResolved,
    count: 0,
  }));
  const progressMatchesVisibleComments =
    renderProgress.comments === deferredComments &&
    renderProgress.filter === deferredFilter &&
    renderProgress.hideResolved === deferredHideResolved;
  const renderedCommentCount = progressMatchesVisibleComments
    ? Math.min(renderProgress.count, visibleComments.length)
    : 0;
  const renderedGroups = useMemo(
    () => limitCommentGroups(commentGroups, renderedCommentCount),
    [commentGroups, renderedCommentCount],
  );

  useEffect(() => {
    if (renderedCommentCount >= visibleComments.length) {
      return;
    }

    const frameId = globalThis.requestAnimationFrame(() => {
      startTransition(() => {
        setRenderProgress((current) => {
          let currentCount = 0;
          if (
            current.comments === deferredComments &&
            current.filter === deferredFilter &&
            current.hideResolved === deferredHideResolved
          ) {
            currentCount = current.count;
          }
          return {
            comments: deferredComments,
            filter: deferredFilter,
            hideResolved: deferredHideResolved,
            count: Math.min(currentCount + 1, visibleComments.length),
          };
        });
      });
    });

    return () => {
      globalThis.cancelAnimationFrame(frameId);
    };
  }, [
    deferredComments,
    deferredFilter,
    deferredHideResolved,
    renderedCommentCount,
    visibleComments.length,
  ]);

  const updateHideResolved = (hideResolved: boolean): void => {
    const nextFilters = { hideResolved };
    setCommentFilters(nextFilters);
    persistTaskExecutionCiCommentFilters(nextFilters);
  };

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
      <div className="border-t border-border">
        {comments.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">No comments reported.</div>
        ) : (
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
                        isActive &&
                          "bg-foreground/10 text-foreground shadow-sm hover:bg-foreground/15",
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
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn("h-9 px-2", commentFilters.hideResolved && "bg-accent/60")}
                    aria-label="Filter comments"
                  >
                    <ListFilter aria-hidden="true" />
                    <span>Filter</span>
                  </Button>
                </PopoverTrigger>
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
            {visibleComments.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No comments for this filter.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {renderedGroups.map((group) => (
                  <section key={group.id} className="flex flex-col gap-2">
                    {group.title ? (
                      <h4 className="text-xs font-semibold text-muted-foreground">{group.title}</h4>
                    ) : null}
                    <div className="flex flex-col gap-2">
                      {group.comments.map((comment) => (
                        <TaskExecutionCiCommentCard
                          key={comment.id}
                          comment={comment}
                          isBot={isBotCommentAuthor(comment.author)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
});
