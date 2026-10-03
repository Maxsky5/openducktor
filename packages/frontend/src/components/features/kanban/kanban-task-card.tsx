import type { AgentSessionRecord, KanbanTaskCardView, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { PlayCircle, Tag } from "lucide-react";
import { memo, type ReactElement, useId, useMemo } from "react";
import type {
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import {
  IssueTypeBadge,
  PriorityBadge,
  QaRejectedBadge,
} from "@/components/features/kanban/kanban-task-badges";
import { resolveTaskLabelOverflow } from "@/components/features/kanban/kanban-task-label-overflow";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import {
  getTaskFooter,
  type WorkflowPendingState,
} from "@/components/features/kanban/kanban-task-footer";
import type { SessionTargetOptions } from "@/components/features/kanban/session-target-resolution";
import { TASK_ACTION_ICON } from "@/components/features/kanban/task-action-ui";
import { useCardFocus } from "@/components/features/kanban/use-kanban-card-focus";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { TaskSourceIssueLink } from "@/components/features/task-source-issue-link";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BorderRay } from "@/components/ui/border-ray";
import { TaskLabelChip } from "@/components/ui/task-label-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { toDisplayTaskLabels } from "@/lib/task-labels";
import { isQaRejectedTask } from "@/lib/task-qa";
import { cn } from "@/lib/utils";
import { AGENT_ROLE_LABELS } from "@/types";
import { getPriorityStyle, ISSUE_TYPE_STYLES } from "./kanban-task-badge-model";

type CardProps = {
  task: TaskCard;
  taskCardView?: KanbanTaskCardView;
  taskSessions?: KanbanTaskSession[] | undefined;
  historicalSessions?: AgentSessionRecord[] | undefined;
  hasActiveSession?: boolean;
  activeSessionRole?: AgentRole;
  taskActivityState: KanbanTaskActivityState;
  pendingState?: WorkflowPendingState | undefined;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart?: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
  onResetImplementation?: (taskId: string) => void;
};

export const KanbanTaskCard = memo(function KanbanTaskCard({
  task,
  taskCardView = "normal",
  taskSessions = [],
  historicalSessions = [],
  hasActiveSession,
  activeSessionRole,
  taskActivityState,
  pendingState,
  onOpenDetails,
  onDelegate,
  onOpenSession,
  onPlan,
  onQaStart,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
}: CardProps): ReactElement {
  const isActive = hasActiveSession ?? taskSessions.length > 0;
  const isWaitingInput = taskActivityState === "waiting_input";
  const cardActivityClassName = getCardActivityClassName({
    hasActiveSession: isActive,
    isWaitingInput,
  });
  const isCompact = taskCardView === "compact";

  const focus = useCardFocus();
  return (
    <article
      ref={focus.cardRef}
      onFocusCapture={focus.onFocusCapture}
      onBlurCapture={focus.onBlurCapture}
      data-kanban-task-id={task.id}
      className={cn(
        "kanban-task-card-clickable group min-w-0 cursor-pointer border border-border/90 bg-card/95 hover:border-info-border",
        isCompact
          ? "rounded-lg shadow-none hover:shadow-sm"
          : "rounded-xl shadow-sm hover:shadow-md",
        cardActivityClassName,
      )}
    >
      {isActive && !isWaitingInput ? (
        <BorderRay turnDurationMs={2000} strokeWidth={4} className="kanban-active-session-ray" />
      ) : null}

      <div
        className={cn(
          "kanban-active-session-content flex min-w-0 flex-col",
          isCompact ? "p-2" : "p-3.5",
        )}
      >
        {isCompact ? (
          <CompactTaskIdentity task={task} onOpenDetails={onOpenDetails} />
        ) : (
          <NormalTaskIdentity task={task} onOpenDetails={onOpenDetails} />
        )}
        {isCompact ? <TaskStatus task={task} compact /> : <TaskMeta task={task} />}
        <TaskActions
          task={task}
          taskSessions={taskSessions}
          historicalSessions={historicalSessions}
          hasActiveSession={isActive}
          {...(activeSessionRole ? { activeSessionRole } : {})}
          taskActivityState={taskActivityState}
          pendingState={pendingState}
          compact={isCompact}
          onPlan={onPlan}
          onDelegate={onDelegate}
          onOpenSession={onOpenSession}
          {...(onQaStart ? { onQaStart } : {})}
          {...(onHumanApprove ? { onHumanApprove } : {})}
          {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
          {...(onResetImplementation ? { onResetImplementation } : {})}
        />
      </div>
    </article>
  );
}, sameProps);

const sameStrings = (left: string[], right: string[]): boolean => {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

const sameTask = (left: TaskCard, right: TaskCard): boolean =>
  left.id === right.id &&
  left.updatedAt === right.updatedAt &&
  left.title === right.title &&
  left.status === right.status &&
  left.issueType === right.issueType &&
  left.documentSummary.qaReport.has === right.documentSummary.qaReport.has &&
  left.documentSummary.qaReport.verdict === right.documentSummary.qaReport.verdict &&
  left.sourceIssue === right.sourceIssue &&
  left.priority === right.priority &&
  sameStrings(left.labels, right.labels) &&
  sameStrings(left.subtaskIds, right.subtaskIds) &&
  left.pullRequest?.number === right.pullRequest?.number &&
  left.pullRequest?.url === right.pullRequest?.url &&
  left.pullRequest?.state === right.pullRequest?.state &&
  sameStrings(left.availableActions, right.availableActions);

const sameHistory = (
  left: AgentSessionRecord[] | undefined,
  right: AgentSessionRecord[] | undefined,
): boolean => {
  const leftSessions = left ?? [];
  const rightSessions = right ?? [];
  if (leftSessions.length !== rightSessions.length) {
    return false;
  }

  for (let index = 0; index < leftSessions.length; index += 1) {
    const leftSession = leftSessions[index];
    const rightSession = rightSessions[index];
    if (!leftSession || !rightSession) {
      return false;
    }

    if (
      agentSessionIdentityKey(leftSession) !== agentSessionIdentityKey(rightSession) ||
      leftSession.role !== rightSession.role ||
      leftSession.startedAt !== rightSession.startedAt
    ) {
      return false;
    }
  }

  return true;
};

const sameTaskSessions = (
  left: KanbanTaskSession[] | undefined,
  right: KanbanTaskSession[] | undefined,
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftSession = left[index];
    const rightSession = right[index];
    if (!leftSession || !rightSession) {
      return false;
    }
    if (
      agentSessionIdentityKey(leftSession) !== agentSessionIdentityKey(rightSession) ||
      leftSession.role !== rightSession.role ||
      leftSession.startedAt !== rightSession.startedAt ||
      leftSession.activityState !== rightSession.activityState
    ) {
      return false;
    }
  }
  return true;
};

function sameProps(previous: CardProps, next: CardProps): boolean {
  return (
    sameTask(previous.task, next.task) &&
    sameTaskSessions(previous.taskSessions, next.taskSessions) &&
    sameHistory(previous.historicalSessions, next.historicalSessions) &&
    previous.hasActiveSession === next.hasActiveSession &&
    previous.activeSessionRole === next.activeSessionRole &&
    previous.taskActivityState === next.taskActivityState &&
    previous.taskCardView === next.taskCardView &&
    previous.pendingState?.isSessionStarting === next.pendingState?.isSessionStarting &&
    previous.pendingState?.approvingTaskId === next.pendingState?.approvingTaskId &&
    previous.pendingState?.requestingChangesTaskId === next.pendingState?.requestingChangesTaskId &&
    previous.pendingState?.resettingImplementationTaskId ===
      next.pendingState?.resettingImplementationTaskId &&
    previous.onOpenDetails === next.onOpenDetails &&
    previous.onDelegate === next.onDelegate &&
    previous.onOpenSession === next.onOpenSession &&
    previous.onPlan === next.onPlan &&
    previous.onQaStart === next.onQaStart &&
    previous.onHumanApprove === next.onHumanApprove &&
    previous.onHumanRequestChanges === next.onHumanRequestChanges &&
    previous.onResetImplementation === next.onResetImplementation
  );
}

const getSessionChipClassName = (isWaitingInput: boolean): string => {
  if (isWaitingInput) {
    return "border-warning-border bg-warning-surface text-warning-muted hover:border-warning-border hover:bg-warning-surface";
  }

  return "border-info-border bg-info-surface text-info-muted hover:border-info-border hover:bg-info-surface";
};

const getSessionStatusLabel = ({
  session,
  isWaitingInput,
}: {
  session: KanbanTaskSession;
  isWaitingInput: boolean;
}): string => {
  if (isWaitingInput) {
    return "Waiting input";
  }

  if (session.activityState === "starting") {
    return "Starting";
  }

  return "Running";
};

const getSessionStatusTextClassName = (isWaitingInput: boolean): string => {
  if (isWaitingInput) {
    return "text-warning-surface-foreground";
  }

  return "text-status-running";
};

const getCardActivityClassName = ({
  hasActiveSession,
  isWaitingInput,
}: {
  hasActiveSession: boolean;
  isWaitingInput: boolean;
}): string | undefined => {
  if (!hasActiveSession) {
    return undefined;
  }

  if (isWaitingInput) {
    return "kanban-waiting-input-card border-warning-border hover:border-warning-border";
  }

  return "kanban-active-session-card border-info-border shadow-info-border";
};

function TaskPrimaryMeta({ task }: { task: TaskCard }): ReactElement {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <IssueTypeBadge issueType={task.issueType} />
        <PriorityBadge priority={task.priority} />
      </div>
      <TaskIdBadge taskId={task.id} className="min-w-0" />
    </div>
  );
}

function TaskLabelOverflowIndicator({ hiddenLabels }: { hiddenLabels: string[] }): ReactElement {
  const hiddenLabelsDescriptionId = useId();

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 shrink-0 items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label={`Show ${hiddenLabels.length} more labels`}
            aria-describedby={hiddenLabelsDescriptionId}
            data-testid="kanban-task-label-overflow"
          >
            +{hiddenLabels.length}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 px-2.5 py-2">
          <div className="flex flex-col gap-1">
            {hiddenLabels.map((label) => (
              <div key={label} className="flex items-center gap-1.5">
                <Tag className="size-3 shrink-0" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
      <span
        id={hiddenLabelsDescriptionId}
        className="sr-only"
        data-testid="kanban-task-label-tooltip"
      >
        {hiddenLabels.join(", ")}
      </span>
    </>
  );
}

function TaskLabelRow({ labels }: { labels: string[] }): ReactElement {
  const { visibleLabels, hiddenLabels } = useMemo(() => resolveTaskLabelOverflow(labels), [labels]);

  return (
    <div className="relative min-w-0">
      <div className="flex min-w-0 items-center gap-1.5" data-testid="kanban-task-label-row">
        {visibleLabels.map((label) => (
          <TaskLabelChip key={label} label={label} className="shrink-0" />
        ))}
        {hiddenLabels.length > 0 ? (
          <TaskLabelOverflowIndicator hiddenLabels={hiddenLabels} />
        ) : null}
      </div>
    </div>
  );
}

function TaskMeta({ task }: { task: TaskCard }): ReactElement {
  const displayLabels = toDisplayTaskLabels(task.labels);

  return (
    <div className="flex flex-col gap-1.5">
      <TaskPrimaryMeta task={task} />
      <TaskStatus task={task} />
      {displayLabels.length > 0 ? <TaskLabelRow labels={displayLabels} /> : null}
    </div>
  );
}

function CompactTaskMeta({
  task,
  onOpenDetails,
}: {
  task: TaskCard;
  onOpenDetails: (taskId: string) => void;
}): ReactElement {
  const issueTypeStyle = ISSUE_TYPE_STYLES[task.issueType] ?? ISSUE_TYPE_STYLES.task;
  const IssueTypeIcon = issueTypeStyle.icon;
  const priorityStyle = getPriorityStyle(task.priority);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-kanban-control="type"
              className={cn(
                "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                issueTypeStyle.iconClassName,
              )}
              aria-label={`Issue type: ${issueTypeStyle.label}`}
              onClick={() => onOpenDetails(task.id)}
            >
              <IssueTypeIcon className="size-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{issueTypeStyle.label}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-kanban-control="priority"
              className={cn(
                "size-2.5 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                priorityStyle.dotClassName,
              )}
              aria-label={`Priority: ${priorityStyle.hint}`}
              onClick={() => onOpenDetails(task.id)}
            />
          </TooltipTrigger>
          <TooltipContent side="top">
            {priorityStyle.label}: {priorityStyle.hint}
          </TooltipContent>
        </Tooltip>
      </div>
      <button
        type="button"
        data-kanban-control="details"
        aria-label={`Open details for ${task.title}`}
        className="min-w-0 flex-1 cursor-pointer rounded-sm text-left text-sm font-medium text-foreground outline-none after:absolute after:-inset-px after:z-1 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/40"
        title={task.title}
        onClick={() => onOpenDetails(task.id)}
      >
        <span className="block truncate">{task.title}</span>
      </button>
    </div>
  );
}

function NormalTaskIdentity({
  task,
  onOpenDetails,
}: {
  task: TaskCard;
  onOpenDetails: (taskId: string) => void;
}): ReactElement {
  return (
    <button
      type="button"
      data-kanban-control="details"
      aria-label={`Open details for ${task.title}`}
      title={task.title}
      className="mb-2 block w-full cursor-pointer rounded-md text-left outline-none after:absolute after:-inset-px after:z-1 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/40"
      onClick={() => onOpenDetails(task.id)}
    >
      <span className="line-clamp-2 break-words text-sm font-semibold leading-tight text-foreground">
        {task.title}
      </span>
    </button>
  );
}

function CompactTaskIdentity({
  task,
  onOpenDetails,
}: {
  task: TaskCard;
  onOpenDetails: (taskId: string) => void;
}): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1">
        <CompactTaskMeta task={task} onOpenDetails={onOpenDetails} />
      </div>
      <TaskIdBadge taskId={task.id} iconOnly />
    </div>
  );
}

function TaskStatus({
  task,
  compact = false,
}: {
  task: TaskCard;
  compact?: boolean;
}): ReactElement | null {
  const hasStatus =
    task.subtaskIds.length > 0 || Boolean(task.pullRequest) || Boolean(task.sourceIssue);
  if (!hasStatus && !isQaRejectedTask(task)) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <QaRejectedBadge task={task} />
      {task.subtaskIds.length > 0 ? (
        <Badge
          variant="secondary"
          className={
            compact
              ? "h-6 rounded-full px-2 text-xs"
              : "h-6 rounded-full border border-border bg-card px-2.5 text-[11px] text-foreground"
          }
        >
          {compact && task.subtaskIds.length === 1
            ? "1 subtask"
            : `${task.subtaskIds.length} subtasks`}
        </Badge>
      ) : null}
      {task.pullRequest ? (
        <TaskPullRequestLink
          pullRequest={task.pullRequest}
          className={compact ? "h-6 px-2 py-0 text-xs" : ""}
        />
      ) : null}
      {task.sourceIssue ? (
        <TaskSourceIssueLink
          sourceIssue={task.sourceIssue}
          className={compact ? "h-6 px-2 py-0 text-xs" : ""}
        />
      ) : null}
    </div>
  );
}

const taskActionsContainerClassName = (compact: boolean): string =>
  cn("flex flex-col gap-1", compact ? "mt-1.5" : "mt-2 border-t border-border pt-2.5");

const taskActionsGroupClassName = (compact: boolean): string =>
  compact ? "gap-1.5 [&_button]:h-7 [&_button]:rounded-md" : "";

const taskActionsPrimaryClassName = ({
  compact,
  hasActiveSession,
  isWaitingInput,
}: {
  compact: boolean;
  hasActiveSession: boolean;
  isWaitingInput: boolean;
}): string => {
  if (hasActiveSession) {
    return cn(
      compact
        ? "h-7 rounded-md px-2 py-0 text-xs font-medium shadow-none"
        : "h-9 rounded-lg px-2 py-1 text-[11px] font-semibold shadow-none",
      getSessionChipClassName(isWaitingInput),
    );
  }

  return compact
    ? "h-7 rounded-md px-2 text-xs font-medium shadow-none"
    : "h-9 rounded-lg font-semibold shadow-sm";
};

const taskActionSessionStatusClassName = (compact: boolean, isWaitingInput: boolean): string =>
  cn(
    compact ? "text-xs" : "text-[10px]",
    "font-medium",
    getSessionStatusTextClassName(isWaitingInput),
  );

type TaskActionsProps = Omit<CardProps, "onOpenDetails" | "taskCardView"> & {
  taskSessions: KanbanTaskSession[];
  historicalSessions: AgentSessionRecord[];
  hasActiveSession: boolean;
  compact?: boolean;
};

/** Open only resolved sessions; use workflow handlers for session starts and task changes. */
function TaskActions({
  task,
  onPlan,
  onQaStart,
  onDelegate,
  onOpenSession,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
  taskSessions,
  historicalSessions,
  hasActiveSession,
  activeSessionRole,
  taskActivityState,
  pendingState,
  compact = false,
}: TaskActionsProps): ReactElement | null {
  if (task.status === "closed") {
    return null;
  }

  const footer = getTaskFooter({
    task,
    taskSessions,
    historicalSessions,
    hasActiveSession,
    activeSessionRole,
    taskActivityState,
    pendingState,
  });
  const { primaryActiveSession, primarySessionIsWaitingInput } = footer;
  if (footer.actions.allActions.length === 0 && footer.shortcuts.length === 0) return null;

  const openRoleSession = (role: AgentRole): void => {
    const options = footer.sessions.find((session) => session.role === role)?.options;
    if (options) onOpenSession(task.id, role, options);
  };

  const runAction = (action: TaskWorkflowAction): void => {
    switch (action) {
      case "set_spec":
      case "set_plan":
        onPlan(task.id, action);
        return;
      case "open_spec":
        openRoleSession("spec");
        return;
      case "open_planner":
        openRoleSession("planner");
        return;
      case "open_builder":
        openRoleSession("build");
        return;
      case "open_qa":
        openRoleSession("qa");
        return;
      case "qa_start":
        onQaStart?.(task.id);
        return;
      case "build_start":
        onDelegate(task.id);
        return;
      case "human_approve":
        onHumanApprove?.(task.id);
        return;
      case "human_request_changes":
        onHumanRequestChanges?.(task.id);
        return;
      case "reset_implementation":
        onResetImplementation?.(task.id);
        return;
      default:
        return;
    }
  };
  return (
    <div
      className={cn(
        taskActionsContainerClassName(compact),
        footer.shortcuts.length > 0 && (compact ? "mt-0" : "pt-0"),
      )}
    >
      {footer.shortcuts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-kanban-session-shortcuts>
          {footer.shortcuts.map(({ role, action, label, options }) => (
            <Tooltip key={role}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className={cn(
                    "gap-1 px-1 text-muted-foreground hover:text-foreground [&_svg]:size-3",
                    compact ? "h-6" : "h-7",
                  )}
                  data-kanban-control={`session:${role}`}
                  aria-label={`Open ${label} session`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenSession(task.id, role, options);
                  }}
                >
                  <span className="underline decoration-muted-foreground/50 underline-offset-4">
                    {label}
                  </span>
                  {TASK_ACTION_ICON[action]}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open {label} session</TooltipContent>
            </Tooltip>
          ))}
        </div>
      ) : null}
      <TaskWorkflowActionGroup
        task={task}
        actions={footer.actions}
        disabledActions={footer.disabledActions}
        hideWhenEmpty
        onAction={runAction}
        size="sm"
        expandPrimary
        compactMenuTrigger
        className={taskActionsGroupClassName(compact)}
        primaryClassName={taskActionsPrimaryClassName({
          compact,
          hasActiveSession,
          isWaitingInput: primarySessionIsWaitingInput,
        })}
        primaryContent={
          hasActiveSession && primaryActiveSession ? (
            <>
              <PlayCircle className="size-3" />
              {AGENT_ROLE_LABELS[primaryActiveSession.role] ?? primaryActiveSession.role}
              <span
                className={taskActionSessionStatusClassName(compact, primarySessionIsWaitingInput)}
              >
                {getSessionStatusLabel({
                  session: primaryActiveSession,
                  isWaitingInput: primarySessionIsWaitingInput,
                })}
              </span>
            </>
          ) : undefined
        }
      />
    </div>
  );
}
