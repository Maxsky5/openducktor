import type { TaskCard } from "@openducktor/contracts";
import type { ReactElement } from "react";
import {
  IssueTypeBadge,
  PriorityBadge,
  QaRejectedBadge,
} from "@/components/features/kanban/kanban-task-badges";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { TaskSourceIssueLink } from "@/components/features/task-source-issue-link";
import { Badge } from "@/components/ui/badge";

type TaskHeaderBadgesProps = {
  task: TaskCard;
  subtasksCount: number;
  showQaPolicy?: boolean;
};

/** Task metadata shared by the detail sheet and sidebar preview. */
export function TaskHeaderBadges({
  task,
  subtasksCount,
  showQaPolicy = true,
}: TaskHeaderBadgesProps): ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <IssueTypeBadge issueType={task.issueType} />
      <PriorityBadge priority={task.priority} />
      {task.pullRequest ? <TaskPullRequestLink pullRequest={task.pullRequest} /> : null}
      {task.sourceIssue ? <TaskSourceIssueLink sourceIssue={task.sourceIssue} /> : null}
      <QaRejectedBadge task={task} />
      {showQaPolicy && (
        <Badge
          variant="outline"
          className={
            task.aiReviewEnabled
              ? "border-success-border bg-success-surface text-success-muted"
              : "border-input bg-muted text-foreground"
          }
        >
          {task.aiReviewEnabled ? "AI QA required" : "AI QA optional"}
        </Badge>
      )}
      {task.issueType === "epic" ? (
        <Badge
          variant="outline"
          className="border-pending-border bg-pending-surface text-pending-muted"
        >
          {subtasksCount} subtask{subtasksCount === 1 ? "" : "s"}
        </Badge>
      ) : null}
    </div>
  );
}
