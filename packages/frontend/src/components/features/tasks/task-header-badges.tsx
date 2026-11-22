import { taskIssueType } from "@openducktor/workflows";
import type { ReactElement, ReactNode } from "react";
import {
  IssueTypeBadge,
  PriorityBadge,
  ReviewRejectedBadge,
} from "@/components/features/kanban/kanban-task-badges";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { TaskSourceIssueLink } from "@/components/features/task-source-issue-link";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { cn } from "@/lib/utils";

/** Task metadata shared by the detail sheet and sidebar preview. `children` follow the badges. */
export function TaskHeaderBadges({
  task,
  className,
  children,
}: {
  task: TaskCard;
  className?: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-2", className)}>
      <IssueTypeBadge issueType={taskIssueType(task)} />
      <PriorityBadge priority={task.priority} />
      {task.pullRequest ? <TaskPullRequestLink pullRequest={task.pullRequest} /> : null}
      {task.sourceIssue ? <TaskSourceIssueLink sourceIssue={task.sourceIssue} /> : null}
      <ReviewRejectedBadge task={task} />
      {children}
    </div>
  );
}
