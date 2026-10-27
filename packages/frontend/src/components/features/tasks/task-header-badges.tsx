import type { ReactElement } from "react";
import {
  IssueTypeBadge,
  PriorityBadge,
  QaRejectedBadge,
} from "@/components/features/kanban/kanban-task-badges";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { TaskSourceIssueLink } from "@/components/features/task-source-issue-link";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

/** Task metadata shared by the detail sheet and sidebar preview. */
export function TaskHeaderBadges({ task }: { task: TaskCard }): ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <IssueTypeBadge issueType={task.issueType} />
      <PriorityBadge priority={task.priority} />
      {task.pullRequest ? <TaskPullRequestLink pullRequest={task.pullRequest} /> : null}
      {task.sourceIssue ? <TaskSourceIssueLink sourceIssue={task.sourceIssue} /> : null}
      <QaRejectedBadge task={task} />
    </div>
  );
}
