import type { PullRequestReviewComment } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { TaskExecutionCiCommentCard } from "./task-execution-ci-comment-card";

export function TaskExecutionCiCommentsList({
  comments,
}: {
  comments: PullRequestReviewComment[];
}): ReactElement {
  if (comments.length === 0) {
    return <p className="text-sm text-muted-foreground">No comments reported.</p>;
  }

  return (
    <div className="space-y-2">
      {comments.map((comment) => (
        <TaskExecutionCiCommentCard key={comment.id} comment={comment} />
      ))}
    </div>
  );
}
