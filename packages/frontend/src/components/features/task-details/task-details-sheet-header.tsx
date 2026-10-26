import type { RepositoryGitProviderContext, TaskCard } from "@openducktor/contracts";
import { Link2, Sparkles, Unlink } from "lucide-react";
import type { ReactElement } from "react";
import { TaskHeaderBadges } from "@/components/features/tasks/task-header-badges";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskLabelChip } from "@/components/ui/task-label-chip";
import {
  resolveTaskPullRequestActions,
  TASK_PULL_REQUEST_ACTION_LABELS,
} from "@openducktor/frontend-core/tasks/pull-requests/pull-request-presentation";
import { statusBadgeClassName } from "@/lib/task-status-presentation";
import { statusLabel } from "@openducktor/frontend-core/tasks/presentation/task-status-presentation";
import { formatElapsedAgo, useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import { humanDate } from "@openducktor/frontend-core/tasks/presentation/task-display";

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
            {isDetecting
              ? TASK_PULL_REQUEST_ACTION_LABELS.detecting
              : TASK_PULL_REQUEST_ACTION_LABELS.detect}
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
          {isUnlinking
            ? TASK_PULL_REQUEST_ACTION_LABELS.unlinking
            : TASK_PULL_REQUEST_ACTION_LABELS.unlink}
        </Button>
      ) : null}
    </div>
  );
}

function TaskDate({
  label,
  value,
  now,
}: {
  label: string;
  value: string;
  now: number;
}): ReactElement {
  return (
    <span>
      {label}{" "}
      <time dateTime={value} title={humanDate(value)}>
        {formatElapsedAgo(now - Date.parse(value))}
      </time>
    </span>
  );
}

function TaskDates({
  createdAt,
  updatedAt,
}: {
  createdAt: string;
  updatedAt: string;
}): ReactElement {
  const now = useMinuteClock();
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <TaskDate label="Created" value={createdAt} now={now} />
      <span aria-hidden="true">·</span>
      <TaskDate label="Updated" value={updatedAt} now={now} />
    </p>
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
  const pullRequestActions = resolveTaskPullRequestActions(
    task,
    gitProviderContext,
    gitProviderReadError,
  );
  const detectPullRequestDisabledReason = pullRequestActions.detectDisabledReason;
  const showDetectPullRequest = pullRequestActions.showDetect && onDetectPullRequest !== undefined;
  const showUnlinkPullRequest = pullRequestActions.showUnlink && onUnlinkPullRequest !== undefined;

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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TaskIdBadge taskId={task.id} />
            <TaskDates createdAt={task.createdAt} updatedAt={task.updatedAt} />
          </div>
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
