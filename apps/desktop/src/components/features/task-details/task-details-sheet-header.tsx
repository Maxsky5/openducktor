import type { TaskCard } from "@openducktor/contracts";
import { Link2, Sparkles, Unlink } from "lucide-react";
import type { ReactElement } from "react";
import { IssueTypeBadge, PriorityBadge } from "@/components/features/kanban/kanban-task-badges";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canUnlinkTaskPullRequest, statusBadgeClassName, statusLabel } from "@/lib/task-display";
import { isQaRejectedTask } from "@/lib/task-qa";

type TaskDetailsSheetHeaderProps = {
  task: TaskCard;
  subtasksCount: number;
  taskLabels: string[];
  onDetectPullRequest?: () => void;
  onUnlinkPullRequest?: () => void;
  isDetectingPullRequest?: boolean;
  isUnlinkingPullRequest?: boolean;
};

export function TaskDetailsSheetHeader({
  task,
  subtasksCount,
  taskLabels,
  onDetectPullRequest,
  onUnlinkPullRequest,
  isDetectingPullRequest = false,
  isUnlinkingPullRequest = false,
}: TaskDetailsSheetHeaderProps): ReactElement {
  const isEpic = task.issueType === "epic";
  const qaRejected = isQaRejectedTask(task);
  const showDetectPullRequest =
    task.pullRequest == null && canUnlinkTaskPullRequest(task.status) && onDetectPullRequest;
  const showUnlinkPullRequest =
    task.pullRequest != null && canUnlinkTaskPullRequest(task.status) && onUnlinkPullRequest;
  const showPullRequestActions = showDetectPullRequest || showUnlinkPullRequest;
  const aiReviewBadge = task.aiReviewEnabled ? (
    <Badge
      variant="outline"
      className="border-success-border bg-success-surface text-success-muted"
    >
      AI QA required
    </Badge>
  ) : (
    <Badge variant="outline" className="border-input bg-muted text-foreground">
      AI QA optional
    </Badge>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Sparkles className="size-5 shrink-0 text-primary" />
            <span className="truncate">{task.title}</span>
          </h2>
          <p className="truncate font-mono text-xs text-muted-foreground">{task.id}</p>
        </div>
        <Badge variant="outline" className={statusBadgeClassName(task.status)}>
          {statusLabel(task.status)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <IssueTypeBadge issueType={task.issueType} />
          <PriorityBadge priority={task.priority} />
          {task.pullRequest ? <TaskPullRequestLink pullRequest={task.pullRequest} /> : null}
          {qaRejected ? (
            <Badge
              variant="outline"
              className="border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300"
            >
              QA Rejected
            </Badge>
          ) : null}
          {aiReviewBadge}
          {isEpic ? (
            <Badge
              variant="outline"
              className="border-pending-border bg-pending-surface text-pending-muted"
            >
              {subtasksCount} subtask{subtasksCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>
        {showPullRequestActions ? (
          <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto">
            {showDetectPullRequest ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-semibold text-muted-foreground hover:text-foreground"
                onClick={onDetectPullRequest}
                disabled={isDetectingPullRequest}
                data-testid="task-details-detect-pr-button"
              >
                <Link2 data-icon="inline-start" />
                {isDetectingPullRequest ? "Detecting PR" : "Detect PR"}
              </Button>
            ) : null}
            {showUnlinkPullRequest ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-semibold text-muted-foreground hover:text-foreground"
                onClick={onUnlinkPullRequest}
                disabled={isUnlinkingPullRequest}
                data-testid="task-details-unlink-pr-button"
              >
                <Unlink data-icon="inline-start" />
                {isUnlinkingPullRequest ? "Unlinking PR" : "Unlink PR"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {taskLabels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {taskLabels.map((label) => (
            <Badge
              key={label}
              variant="outline"
              className="h-6 rounded-full border-input bg-card px-2.5 text-[11px] font-medium text-foreground"
            >
              {label}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
