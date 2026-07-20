import type { PullRequestReviewComment } from "@openducktor/contracts";
import { ChevronRight, MessageSquare } from "lucide-react";
import type { ReactElement } from "react";
import { memo, startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TaskExecutionCiCommentCard } from "./task-execution-ci-comment-card";
import { isBotCommentAuthor } from "./task-execution-ci-presentation";

type CommentFilter = "all" | "humans" | "bots";

type CommentGroup = {
  id: "conversation" | "needs-review" | "resolved";
  comments: PullRequestReviewComment[];
  title: string;
};

type CommentRenderProgress = {
  comments: readonly PullRequestReviewComment[];
  filter: CommentFilter;
  count: number;
};

const COMMENT_FILTERS: Array<{ id: CommentFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "humans", label: "Humans" },
  { id: "bots", label: "Bots" },
];

const filterComments = (
  comments: readonly PullRequestReviewComment[],
  filter: CommentFilter,
): PullRequestReviewComment[] => {
  if (filter === "all") {
    return [...comments];
  }
  return comments.filter((comment) => {
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
  const deferredComments = useDeferredValue(comments);
  const deferredFilter = useDeferredValue(filter);
  const counts = useMemo(
    () => ({
      all: comments.length,
      bots: comments.filter((comment) => isBotCommentAuthor(comment.author)).length,
      humans: comments.filter((comment) => !isBotCommentAuthor(comment.author)).length,
    }),
    [comments],
  );
  const visibleComments = useMemo(
    () => filterComments(deferredComments, deferredFilter),
    [deferredComments, deferredFilter],
  );
  const groups = useMemo(() => groupComments(visibleComments), [visibleComments]);
  const [renderProgress, setRenderProgress] = useState<CommentRenderProgress>(() => ({
    comments: deferredComments,
    filter: deferredFilter,
    count: 0,
  }));
  const progressMatchesVisibleComments =
    renderProgress.comments === deferredComments && renderProgress.filter === deferredFilter;
  const renderedCommentCount = progressMatchesVisibleComments
    ? Math.min(renderProgress.count, visibleComments.length)
    : 0;
  const renderedGroups = useMemo(
    () => limitCommentGroups(groups, renderedCommentCount),
    [groups, renderedCommentCount],
  );

  useEffect(() => {
    if (renderedCommentCount >= visibleComments.length) {
      return;
    }

    const frameId = globalThis.requestAnimationFrame(() => {
      startTransition(() => {
        setRenderProgress((current) => {
          let currentCount = 0;
          if (current.comments === deferredComments && current.filter === deferredFilter) {
            currentCount = current.count;
          }
          return {
            comments: deferredComments,
            filter: deferredFilter,
            count: Math.min(currentCount + 1, visibleComments.length),
          };
        });
      });
    });

    return () => {
      globalThis.cancelAnimationFrame(frameId);
    };
  }, [deferredComments, deferredFilter, renderedCommentCount, visibleComments.length]);

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
          <div className="space-y-3 px-4 py-3">
            <div className="grid grid-cols-3 rounded-md border border-border bg-muted/30 p-1">
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
            {groups.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No comments for this filter.
              </div>
            ) : (
              <div className="space-y-4">
                {renderedGroups.map((group) => (
                  <section key={group.id} className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground">{group.title}</h4>
                    <div className="space-y-2">
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
