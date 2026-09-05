import type { RepositoryGitProviderContext, TaskCard } from "@openducktor/contracts";
import { Link2, Sparkles, Unlink } from "lucide-react";
import type { ReactElement } from "react";
import { IssueTypeBadge, PriorityBadge } from "@/components/features/kanban/kanban-task-badges";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskLabelChip } from "@/components/ui/task-label-chip";
import { pullRequestHealthError } from "@/lib/git-provider-health";
import { canUnlinkTaskPullRequest, statusBadgeClassName, statusLabel } from "@/lib/task-display";
import { isQaRejectedTask } from "@/lib/task-qa";

type TaskDetailsSheetHeaderProps = {
  task: TaskCard;
  subtasksCount: number;
  taskLabels: string[];
  onDetectPullRequest?: () => void;
  gitProviderContext?: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
  onUnlinkPullRequest?: () => void;
  isDetectingPullRequest?: boolean;
  isUnlinkingPullRequest?: boolean;
};

function TaskHeaderBadges({ task, subtasksCount }: { task: TaskCard; subtasksCount: number }) {
  const isEpic = task.issueType === "epic";
  const qaRejected = isQaRejectedTask(task);
  return (
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
      {task.aiReviewEnabled ? (
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
      )}
      {isEpic ? (
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

function TaskPullRequestActions({
  disabledReason,
  isDetecting,
  isUnlinking,
  onDetect,
  onUnlink,
}: {
  disabledReason: string | null;
  isDetecting: boolean;
  isUnlinking: boolean;
  onDetect?: () => void;
  onUnlink?: () => void;
}): ReactElement {
  const errorId = disabledReason ? "task-details-detect-pr-error" : undefined;
  return (
    <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto">
      {onDetect ? (
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-semibold text-muted-foreground hover:text-foreground"
            onClick={onDetect}
            disabled={isDetecting || disabledReason !== null}
            aria-describedby={errorId}
            data-testid="task-details-detect-pr-button"
          >
            <Link2 data-icon="inline-start" />
            {isDetecting ? "Detecting PR" : "Detect PR"}
          </Button>
          {disabledReason ? (
            <p id={errorId} className="max-w-72 text-right text-xs text-destructive">
              {disabledReason}
            </p>
          ) : null}
        </div>
      ) : null}
      {onUnlink ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="font-semibold text-muted-foreground hover:text-foreground"
          onClick={onUnlink}
          disabled={isUnlinking}
          data-testid="task-details-unlink-pr-button"
        >
          <Unlink data-icon="inline-start" />
          {isUnlinking ? "Unlinking PR" : "Unlink PR"}
        </Button>
      ) : null}
    </div>
  );
}

export function TaskDetailsSheetHeader({
  task,
  subtasksCount,
  taskLabels,
  onDetectPullRequest,
  gitProviderContext,
  gitProviderReadError = null,
  onUnlinkPullRequest,
  isDetectingPullRequest = false,
  isUnlinkingPullRequest = false,
}: TaskDetailsSheetHeaderProps): ReactElement {
  const detectPullRequestDisabledReason =
    gitProviderReadError ?? pullRequestHealthError(gitProviderContext);
  const supportsPullRequests =
    gitProviderContext?.descriptor.capabilities.supportsPullRequests === true;
  const readFailedWithoutContext = gitProviderContext == null && gitProviderReadError !== null;
  const showDetectPullRequest =
    (supportsPullRequests || readFailedWithoutContext) &&
    task.pullRequest == null &&
    canUnlinkTaskPullRequest(task.status) &&
    onDetectPullRequest !== undefined;
  const showUnlinkPullRequest =
    task.pullRequest != null &&
    canUnlinkTaskPullRequest(task.status) &&
    onUnlinkPullRequest !== undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Sparkles className="size-5 shrink-0 text-primary" />
            <span className="truncate" title={task.title}>
              {task.title}
            </span>
          </h2>
          <TaskIdBadge taskId={task.id} />
        </div>
        <Badge variant="outline" className={statusBadgeClassName(task.status)}>
          {statusLabel(task.status)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <TaskHeaderBadges task={task} subtasksCount={subtasksCount} />
        {showDetectPullRequest || showUnlinkPullRequest ? (
          <TaskPullRequestActions
            disabledReason={detectPullRequestDisabledReason}
            isDetecting={isDetectingPullRequest}
            isUnlinking={isUnlinkingPullRequest}
            {...(showDetectPullRequest ? { onDetect: onDetectPullRequest } : {})}
            {...(showUnlinkPullRequest ? { onUnlink: onUnlinkPullRequest } : {})}
          />
        ) : null}
      </div>

      {taskLabels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {taskLabels.map((label) => (
            <TaskLabelChip key={label} label={label} className="max-w-full" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
