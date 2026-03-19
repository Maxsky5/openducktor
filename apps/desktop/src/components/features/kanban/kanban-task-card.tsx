import type { RunSummary, TaskCard } from "@openducktor/contracts";
import { ExternalLink, PlayCircle } from "lucide-react";
import { memo, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type {
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import {
  IssueTypeBadge,
  PriorityBadge,
  QaRejectedBadge,
  RunStateBadge,
  type VisibleKanbanRunState,
} from "@/components/features/kanban/kanban-task-badges";
import {
  resolveTaskCardActions,
  type TaskWorkflowAction,
} from "@/components/features/kanban/kanban-task-workflow";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Badge } from "@/components/ui/badge";
import { BorderRay } from "@/components/ui/border-ray";
import { cn } from "@/lib/utils";
import { AGENT_ROLE_LABELS } from "@/types";

const toVisibleKanbanRunState = (
  runState: RunSummary["state"] | undefined,
): VisibleKanbanRunState | undefined => {
  if (!runState) {
    return undefined;
  }

  if (
    runState === "starting" ||
    runState === "running" ||
    runState === "awaiting_done_confirmation" ||
    runState === "completed" ||
    runState === "stopped"
  ) {
    return undefined;
  }

  return runState;
};

type KanbanTaskCardProps = {
  task: TaskCard;
  runState?: RunSummary["state"] | undefined;
  taskSessions?: KanbanTaskSession[] | undefined;
  taskActivityState: KanbanTaskActivityState;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
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
  areStringArraysEqual(left.subtaskIds, right.subtaskIds) &&
  left.pullRequest?.number === right.pullRequest?.number &&
  left.pullRequest?.url === right.pullRequest?.url &&
  left.pullRequest?.state === right.pullRequest?.state &&
  areStringArraysEqual(left.availableActions, right.availableActions);

const areRunningTaskSessionsEqual = (
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
      leftSession.sessionId !== rightSession.sessionId ||
      leftSession.role !== rightSession.role ||
      leftSession.scenario !== rightSession.scenario ||
      leftSession.status !== rightSession.status ||
      leftSession.presentationState !== rightSession.presentationState
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
  previous.runState === next.runState &&
  areRunningTaskSessionsEqual(previous.taskSessions, next.taskSessions) &&
  previous.taskActivityState === next.taskActivityState &&
  previous.onOpenDetails === next.onOpenDetails &&
  previous.onDelegate === next.onDelegate &&
  previous.onPlan === next.onPlan &&
  previous.onQaStart === next.onQaStart &&
  previous.onQaOpen === next.onQaOpen &&
  previous.onBuild === next.onBuild &&
  previous.onHumanApprove === next.onHumanApprove &&
  previous.onHumanRequestChanges === next.onHumanRequestChanges &&
  previous.onResetImplementation === next.onResetImplementation;

const getSessionStatusLabel = (session: KanbanTaskSession): string => {
  if (session.presentationState === "waiting_input") {
    return "Waiting input";
  }

  if (session.status === "starting") {
    return "Starting";
  }

  return "Running";
};

const getSessionChipClassName = (isWaitingInput: boolean): string => {
  if (isWaitingInput) {
    return "border-warning-border bg-warning-surface text-warning-muted hover:border-warning-border hover:bg-warning-surface";
  }

  return "border-info-border bg-info-surface text-info-muted hover:border-info-border hover:bg-info-surface";
};

const getSessionStatusTextClassName = (isWaitingInput: boolean): string => {
  if (isWaitingInput) {
    return "text-warning-surface-foreground";
  }

  return "text-primary/90";
};

const getCardActivityClassName = ({
  hasTaskSessions,
  isWaitingInput,
}: {
  hasTaskSessions: boolean;
  isWaitingInput: boolean;
}): string | undefined => {
  if (!hasTaskSessions) {
    return undefined;
  }

  if (isWaitingInput) {
    return "kanban-waiting-input-card border-warning-border hover:border-warning-border";
  }

  return "kanban-active-session-card border-info-border shadow-info-border";
};

function toSessionHref({
  taskId,
  session,
}: {
  taskId: string;
  session: KanbanTaskSession;
}): string {
  const params = new URLSearchParams({
    task: taskId,
    session: session.sessionId,
    agent: session.role,
    scenario: session.scenario,
  });

  return `/agents?${params.toString()}`;
}

const ActiveSessionChip = memo(
  function ActiveSessionChip({
    taskId,
    session,
  }: {
    taskId: string;
    session: KanbanTaskSession;
  }): ReactElement {
    const roleLabel = AGENT_ROLE_LABELS[session.role] ?? session.role;
    const isWaitingInput = session.presentationState === "waiting_input";
    const statusLabel = getSessionStatusLabel(session);

    return (
      <Link
        to={toSessionHref({ taskId, session })}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition",
          getSessionChipClassName(isWaitingInput),
        )}
      >
        <PlayCircle className="size-3" />
        {roleLabel}
        <span
          className={cn("text-[10px] font-medium", getSessionStatusTextClassName(isWaitingInput))}
        >
          {statusLabel}
        </span>
      </Link>
    );
  },
  (previous, next) =>
    previous.taskId === next.taskId &&
    previous.session.sessionId === next.session.sessionId &&
    previous.session.role === next.session.role &&
    previous.session.scenario === next.session.scenario &&
    previous.session.status === next.session.status &&
    previous.session.presentationState === next.session.presentationState,
);

function TaskSessionsLine({
  taskId,
  taskSessions,
  taskActivityState,
}: {
  taskId: string;
  taskSessions: KanbanTaskSession[];
  taskActivityState: KanbanTaskActivityState;
}): ReactElement {
  const isWaitingInput = taskActivityState === "waiting_input";

  return (
    <div
      className={cn(
        "space-y-1 border-t pt-2",
        isWaitingInput ? "border-warning-border" : "border-info-border",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Sessions
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {taskSessions.map((session) => (
          <ActiveSessionChip key={session.sessionId} taskId={taskId} session={session} />
        ))}
      </div>
    </div>
  );
}

function TaskMeta({
  task,
  runState,
}: {
  task: TaskCard;
  runState: VisibleKanbanRunState | undefined;
}): ReactElement {
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
      {runState ? <RunStateBadge runState={runState} /> : null}
      {task.pullRequest ? <TaskPullRequestLink pullRequest={task.pullRequest} /> : null}
    </div>
  );
}

function TaskActions({
  task,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
  onDelegate,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
}: {
  task: TaskCard;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart?: (taskId: string) => void;
  onQaOpen?: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
  onResetImplementation?: (taskId: string) => void;
}): ReactElement | null {
  const includeActions: readonly TaskWorkflowAction[] = [
    "set_spec",
    "set_plan",
    "qa_start",
    "build_start",
    "open_builder",
    "open_qa",
    "human_approve",
    "human_request_changes",
    "reset_implementation",
  ];
  const workflowActions = resolveTaskCardActions(task, { include: includeActions });

  if (workflowActions.allActions.length === 0) {
    return null;
  }

  const runAction = (action: TaskWorkflowAction): void => {
    switch (action) {
      case "set_spec":
      case "set_plan":
        onPlan(task.id, action);
        return;
      case "open_builder":
        onBuild(task.id);
        return;
      case "open_qa":
        onQaOpen?.(task.id);
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
    <div className="mt-3 cursor-default border-t border-border pt-2.5">
      <TaskWorkflowActionGroup
        task={task}
        includeActions={includeActions}
        onAction={runAction}
        size="sm"
        expandPrimary
        compactMenuTrigger
        primaryClassName="h-9 rounded-lg font-semibold shadow-sm"
      />
    </div>
  );
}

export const KanbanTaskCard = memo(function KanbanTaskCard({
  task,
  runState,
  taskSessions = [],
  taskActivityState,
  onOpenDetails,
  onDelegate,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
}: KanbanTaskCardProps): ReactElement {
  const hasTaskSessions = taskSessions.length > 0;
  const isWaitingInput = taskActivityState === "waiting_input";
  const visibleRunState = toVisibleKanbanRunState(runState);
  const cardActivityClassName = getCardActivityClassName({ hasTaskSessions, isWaitingInput });

  return (
    <article
      className={cn(
        "group min-w-0 rounded-xl border border-border/90 bg-card/95 shadow-sm transition duration-150 hover:border-info-border hover:shadow-md",
        cardActivityClassName,
      )}
    >
      {hasTaskSessions && !isWaitingInput ? (
        <BorderRay turnDurationMs={2500} strokeWidth={4.4} className="kanban-active-session-ray" />
      ) : null}

      <div className="kanban-active-session-content flex min-w-0 flex-col space-y-2.5 p-3.5">
        {/* biome-ignore lint/a11y/useSemanticElements: TaskIdBadge contains a button element */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`Open details for ${task.title}`}
          className="flex w-full min-w-0 cursor-pointer items-start justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => onOpenDetails(task.id)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenDetails(task.id);
            }
          }}
        >
          <div className="min-w-0 space-y-1">
            <p
              className="line-clamp-2 break-words text-sm font-semibold leading-tight text-foreground"
              title={task.title}
            >
              {task.title}
            </p>
            <TaskIdBadge taskId={task.id} />
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] text-muted-foreground transition group-hover:border-border group-hover:bg-muted group-hover:text-muted-foreground">
            <ExternalLink className="size-3" />
            Open
          </span>
        </div>
        <TaskMeta task={task} runState={visibleRunState} />
        {hasTaskSessions ? (
          <TaskSessionsLine
            taskId={task.id}
            taskSessions={taskSessions}
            taskActivityState={taskActivityState}
          />
        ) : null}
        <TaskActions
          task={task}
          onPlan={onPlan}
          onBuild={onBuild}
          onDelegate={onDelegate}
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
