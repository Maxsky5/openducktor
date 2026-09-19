import type { AgentSessionRecord, KanbanTaskCardView, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { ExternalLink, PlayCircle, Tag } from "lucide-react";
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
import {
  resolveTaskCardActions,
  type TaskWorkflowAction,
} from "@/components/features/kanban/kanban-task-workflow";
import {
  resolveHistoricalSessionRoles,
  resolvePreferredActiveSession,
  resolveSessionTargetOptions,
  type SessionTargetOptions,
} from "@/components/features/kanban/session-target-resolution";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Badge } from "@/components/ui/badge";
import { BorderRay } from "@/components/ui/border-ray";
import { TaskLabelChip } from "@/components/ui/task-label-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { toDisplayTaskLabels } from "@/lib/task-labels";
import { isQaRejectedTask } from "@/lib/task-qa";
import { cn } from "@/lib/utils";
import { AGENT_ROLE_LABELS } from "@/types";
import { getPriorityStyle, ISSUE_TYPE_STYLES } from "./kanban-task-badge-model";

type KanbanTaskCardProps = {
  task: TaskCard;
  taskCardView?: KanbanTaskCardView;
  taskSessions?: KanbanTaskSession[] | undefined;
  historicalSessions?: AgentSessionRecord[] | undefined;
  hasActiveSession?: boolean;
  activeSessionRole?: AgentRole;
  taskActivityState: KanbanTaskActivityState;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession?: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart?: (taskId: string) => void;
  onQaOpen?: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
  onResetImplementation?: (taskId: string) => void;
};

const areStringArraysEqual = (left: string[], right: string[]): boolean => {
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

const areTaskCardsEquivalent = (left: TaskCard, right: TaskCard): boolean =>
  left.id === right.id &&
  left.updatedAt === right.updatedAt &&
  left.title === right.title &&
  left.status === right.status &&
  left.issueType === right.issueType &&
  left.priority === right.priority &&
  areStringArraysEqual(left.labels, right.labels) &&
  areStringArraysEqual(left.subtaskIds, right.subtaskIds) &&
  left.pullRequest?.number === right.pullRequest?.number &&
  left.pullRequest?.url === right.pullRequest?.url &&
  left.pullRequest?.state === right.pullRequest?.state &&
  areStringArraysEqual(left.availableActions, right.availableActions);

const TASK_CARD_WORKFLOW_ACTIONS: readonly TaskWorkflowAction[] = [
  "set_spec",
  "set_plan",
  "open_spec",
  "open_planner",
  "qa_start",
  "build_start",
  "open_builder",
  "open_qa",
  "human_approve",
  "human_request_changes",
  "reset_implementation",
];

const areHistoricalSessionsEqual = (
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

const areTaskSessionsEqual = (
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
      leftSession.activityState !== rightSession.activityState
    ) {
      return false;
    }
  }
  return true;
};

const areKanbanTaskCardPropsEqual = (
  previous: KanbanTaskCardProps,
  next: KanbanTaskCardProps,
): boolean =>
  areTaskCardsEquivalent(previous.task, next.task) &&
  areTaskSessionsEqual(previous.taskSessions, next.taskSessions) &&
  areHistoricalSessionsEqual(previous.historicalSessions, next.historicalSessions) &&
  previous.hasActiveSession === next.hasActiveSession &&
  previous.activeSessionRole === next.activeSessionRole &&
  previous.taskActivityState === next.taskActivityState &&
  previous.taskCardView === next.taskCardView &&
  previous.onOpenDetails === next.onOpenDetails &&
  previous.onDelegate === next.onDelegate &&
  previous.onOpenSession === next.onOpenSession &&
  previous.onPlan === next.onPlan &&
  previous.onQaStart === next.onQaStart &&
  previous.onQaOpen === next.onQaOpen &&
  previous.onBuild === next.onBuild &&
  previous.onHumanApprove === next.onHumanApprove &&
  previous.onHumanRequestChanges === next.onHumanRequestChanges &&
  previous.onResetImplementation === next.onResetImplementation;

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
    <div className="flex flex-wrap items-center gap-1.5">
      <IssueTypeBadge issueType={task.issueType} />
      <PriorityBadge priority={task.priority} />
      <QaRejectedBadge task={task} />
      {task.subtaskIds.length > 0 ? (
        <Badge
          variant="secondary"
          className="h-6 rounded-full border border-border bg-card px-2.5 text-[11px] text-foreground"
        >
          {task.subtaskIds.length} subtasks
        </Badge>
      ) : null}
      {task.pullRequest ? <TaskPullRequestLink pullRequest={task.pullRequest} /> : null}
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
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground"
            aria-label={`Issue type: ${issueTypeStyle.label}`}
            role="img"
            tabIndex={0}
          >
            <IssueTypeIcon className="size-4" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{issueTypeStyle.label}</TooltipContent>
      </Tooltip>
      <button
        type="button"
        aria-label={`Open details for ${task.title}`}
        className="min-w-0 flex-1 truncate rounded-sm text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        title={task.title}
        onClick={() => onOpenDetails(task.id)}
      >
        {task.title}
      </button>
      <span
        className="inline-flex h-5 shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground"
        aria-label={`Priority: ${priorityStyle.hint}`}
        title={priorityStyle.hint}
      >
        <span className={cn("size-1.5 rounded-full", priorityStyle.dotClassName)} />
        {priorityStyle.label}
      </span>
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
    <div className="flex w-full min-w-0 items-start justify-between gap-1.5">
      <div className="mb-1 min-w-0 flex-1">
        <button
          type="button"
          aria-label={`Open details for ${task.title}`}
          className="block w-full cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => onOpenDetails(task.id)}
        >
          <span
            className="mb-1 line-clamp-2 break-words text-sm font-semibold leading-tight text-foreground"
            title={task.title}
          >
            {task.title}
          </span>
        </button>
        <div className="flex items-center justify-between gap-1.5">
          <TaskIdBadge taskId={task.id} />
          <button
            type="button"
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] text-muted-foreground transition group-hover:border-border group-hover:bg-muted group-hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => onOpenDetails(task.id)}
          >
            <ExternalLink className="size-3" />
            Open
          </button>
        </div>
      </div>
    </div>
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

function CompactTaskStatus({ task }: { task: TaskCard }): ReactElement | null {
  const hasStatus = task.subtaskIds.length > 0 || Boolean(task.pullRequest);
  if (!hasStatus && !isQaRejectedTask(task)) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <QaRejectedBadge task={task} />
      {task.subtaskIds.length > 0 ? (
        <Badge variant="secondary" className="h-6 rounded-full px-2 text-xs">
          {task.subtaskIds.length === 1 ? "1 subtask" : `${task.subtaskIds.length} subtasks`}
        </Badge>
      ) : null}
      {task.pullRequest ? (
        <TaskPullRequestLink pullRequest={task.pullRequest} className="h-6 px-2 py-0 text-xs" />
      ) : null}
    </div>
  );
}

const taskActionsContainerClassName = (compact: boolean): string =>
  cn("cursor-default", compact ? "mt-1.5" : "mt-2 border-t border-border pt-2.5");

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

function TaskActions({
  task,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
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
  compact = false,
}: {
  task: TaskCard;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart?: (taskId: string) => void;
  onQaOpen?: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession?: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
  onResetImplementation?: (taskId: string) => void;
  taskSessions: KanbanTaskSession[];
  historicalSessions: AgentSessionRecord[];
  hasActiveSession: boolean;
  activeSessionRole?: AgentRole;
  taskActivityState: KanbanTaskActivityState;
  compact?: boolean;
}): ReactElement | null {
  if (task.status === "closed") {
    return null;
  }

  const historicalSessionRoles = resolveHistoricalSessionRoles(historicalSessions);
  const actionOptions: Parameters<typeof resolveTaskCardActions>[1] = {
    include: TASK_CARD_WORKFLOW_ACTIONS,
    hasActiveSession,
    historicalSessionRoles,
  };
  if (activeSessionRole) {
    actionOptions.activeSessionRole = activeSessionRole;
  }
  const workflowActions = resolveTaskCardActions(task, actionOptions);

  if (workflowActions.allActions.length === 0) {
    return null;
  }

  const primaryActiveSession =
    hasActiveSession && activeSessionRole
      ? resolvePreferredActiveSession(taskSessions, activeSessionRole)
      : null;
  const primarySessionIsWaitingInput =
    primaryActiveSession?.activityState === "waiting_input" ||
    (taskActivityState === "waiting_input" && hasActiveSession);

  const openRoleSession = (role: AgentRole): void => {
    const sessionOptions = resolveSessionTargetOptions(historicalSessions, taskSessions, role);

    if (onOpenSession) {
      onOpenSession(task.id, role, sessionOptions);
      return;
    }

    if (role === "build") {
      onBuild(task.id);
      return;
    }

    if (role === "qa") {
      onQaOpen?.(task.id);
      return;
    }

    onPlan(task.id, role === "spec" ? "set_spec" : "set_plan");
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
    <div className={taskActionsContainerClassName(compact)}>
      <TaskWorkflowActionGroup
        task={task}
        includeActions={TASK_CARD_WORKFLOW_ACTIONS}
        hasActiveSession={hasActiveSession}
        {...(activeSessionRole ? { activeSessionRole } : {})}
        historicalSessionRoles={historicalSessionRoles}
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

export const KanbanTaskCard = memo(function KanbanTaskCard({
  task,
  taskCardView = "normal",
  taskSessions = [],
  historicalSessions = [],
  hasActiveSession,
  activeSessionRole,
  taskActivityState,
  onOpenDetails,
  onDelegate,
  onOpenSession,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
}: KanbanTaskCardProps): ReactElement {
  const hasActiveSessionValue = hasActiveSession ?? taskSessions.length > 0;
  const isWaitingInput = taskActivityState === "waiting_input";
  const cardActivityClassName = getCardActivityClassName({
    hasActiveSession: hasActiveSessionValue,
    isWaitingInput,
  });
  const isCompact = taskCardView === "compact";

  return (
    <article
      data-density={taskCardView}
      className={cn(
        "group min-w-0 border border-border/90 bg-card/95 hover:border-info-border",
        isCompact
          ? "rounded-lg shadow-none hover:shadow-sm"
          : "rounded-xl shadow-sm hover:shadow-md",
        cardActivityClassName,
      )}
    >
      {hasActiveSessionValue && !isWaitingInput ? (
        <BorderRay turnDurationMs={2000} strokeWidth={4} className="kanban-active-session-ray" />
      ) : null}

      <div
        className={cn(
          "kanban-active-session-content flex min-w-0 flex-col gap-y-1",
          isCompact ? "p-2" : "p-3.5",
        )}
      >
        {isCompact ? (
          <CompactTaskIdentity task={task} onOpenDetails={onOpenDetails} />
        ) : (
          <NormalTaskIdentity task={task} onOpenDetails={onOpenDetails} />
        )}
        {isCompact ? <CompactTaskStatus task={task} /> : <TaskMeta task={task} />}
        <TaskActions
          task={task}
          taskSessions={taskSessions}
          historicalSessions={historicalSessions}
          hasActiveSession={hasActiveSessionValue}
          {...(activeSessionRole ? { activeSessionRole } : {})}
          taskActivityState={taskActivityState}
          compact={isCompact}
          onPlan={onPlan}
          onBuild={onBuild}
          onDelegate={onDelegate}
          {...(onOpenSession ? { onOpenSession } : {})}
          {...(onQaStart ? { onQaStart } : {})}
          {...(onQaOpen ? { onQaOpen } : {})}
          {...(onHumanApprove ? { onHumanApprove } : {})}
          {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
          {...(onResetImplementation ? { onResetImplementation } : {})}
        />
      </div>
    </article>
  );
}, areKanbanTaskCardPropsEqual);
