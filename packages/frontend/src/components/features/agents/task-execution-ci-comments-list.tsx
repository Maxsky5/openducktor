import type { PullRequestReviewComment } from "@openducktor/contracts";
import { MessageSquare } from "lucide-react";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TaskExecutionCiCommentCard } from "./task-execution-ci-comment-card";
import { isBotCommentAuthor } from "./task-execution-ci-presentation";

type CommentFilter = "all" | "humans" | "bots";

type CommentGroup = {
  comments: PullRequestReviewComment[];
  title: string;
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

  return [
    { title: `Needs review · ${needsReview.length}`, comments: needsReview },
    { title: `Conversation · ${conversation.length}`, comments: conversation },
    { title: `Resolved · ${resolved.length}`, comments: resolved },
  ].filter((group) => group.comments.length > 0);
};

export function TaskExecutionCiCommentsList({
  comments,
}: {
  comments: PullRequestReviewComment[];
}): ReactElement {
  const [filter, setFilter] = useState<CommentFilter>("all");
  const counts = useMemo(
    () => ({
      all: comments.length,
      bots: comments.filter((comment) => isBotCommentAuthor(comment.author)).length,
      humans: comments.filter((comment) => !isBotCommentAuthor(comment.author)).length,
    }),
    [comments],
  );
  const visibleComments = useMemo(() => filterComments(comments, filter), [comments, filter]);
  const groups = useMemo(() => groupComments(visibleComments), [visibleComments]);

  if (comments.length === 0) {
    return <div className="px-4 py-4 text-sm text-muted-foreground">No comments reported.</div>;
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Comments</h3>
          <Badge variant="secondary" className="shrink-0">
            {comments.length}
          </Badge>
        </div>
      </div>
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
      {groups.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No comments for this filter.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.title} className="space-y-2">
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
  );
}
