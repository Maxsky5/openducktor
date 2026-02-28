import type { RunSummary, TaskCard } from "@openducktor/contracts";
import { ExternalLink, PlayCircle } from "lucide-react";
import { memo, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  IssueTypeBadge,
  PriorityBadge,
  RunStateBadge,
} from "@/components/features/kanban/kanban-task-badges";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import { Badge } from "@/components/ui/badge";
import { BorderRay } from "@/components/ui/border-ray";
import { cn } from "@/lib/utils";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type RunningTaskSession = Pick<AgentSessionState, "sessionId" | "role" | "scenario" | "status">;

type KanbanTaskCardProps = {
  task: TaskCard;
  runState?: RunSummary["state"] | undefined;
  activeSessions?: RunningTaskSession[] | undefined;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
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
  areStringArraysEqual(left.availableActions, right.availableActions);

const areRunningTaskSessionsEqual = (
  left: RunningTaskSession[] | undefined,
  right: RunningTaskSession[] | undefined,
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
      leftSession.status !== rightSession.status
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
  areRunningTaskSessionsEqual(previous.activeSessions, next.activeSessions) &&
  previous.onOpenDetails === next.onOpenDetails &&
  previous.onDelegate === next.onDelegate &&
  previous.onPlan === next.onPlan &&
  previous.onBuild === next.onBuild &&
  previous.onHumanApprove === next.onHumanApprove &&
  previous.onHumanRequestChanges === next.onHumanRequestChanges;

function toSessionHref({
  taskId,
  session,
}: {
  taskId: string;
  session: RunningTaskSession;
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
    session: RunningTaskSession;
  }): ReactElement {
    const roleLabel = AGENT_ROLE_LABELS[session.role] ?? session.role;
    const statusLabel = session.status === "starting" ? "Starting" : "Running";

    return (
      <Link
        to={toSessionHref({ taskId, session })}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 px-2 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300 transition hover:border-sky-300 dark:hover:border-sky-700 hover:bg-sky-100/75 dark:hover:bg-sky-900/50"
      >
        <PlayCircle className="size-3" />
        {roleLabel}
        <span className="text-[10px] font-medium text-primary/90">{statusLabel}</span>
      </Link>
    );
  },
  (previous, next) =>
    previous.taskId === next.taskId &&
    previous.session.sessionId === next.session.sessionId &&
    previous.session.role === next.session.role &&
    previous.session.scenario === next.session.scenario &&
    previous.session.status === next.session.status,
);

function ActiveSessionsLine({
  taskId,
  activeSessions,
}: {
  taskId: string;
  activeSessions: RunningTaskSession[];
}): ReactElement {
  return (
    <div className="space-y-1 border-t border-sky-100/80 pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Active sessions
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {activeSessions.map((session) => (
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
  runState: RunSummary["state"] | undefined;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <IssueTypeBadge issueType={task.issueType} />
      <PriorityBadge priority={task.priority} />
      {task.subtaskIds.length > 0 ? (
        <Badge
          variant="secondary"
          className="h-6 rounded-full border border-border bg-card px-2.5 text-[11px] text-foreground"
        >
          {task.subtaskIds.length} subtasks
        </Badge>
      ) : null}
      {runState ? <RunStateBadge runState={runState} /> : null}
    </div>
  );
}

function TaskActions({
  task,
  onPlan,
  onBuild,
  onDelegate,
  onHumanApprove,
  onHumanRequestChanges,
}: {
  task: TaskCard;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
}): ReactElement {
  const runAction = (action: TaskWorkflowAction): void => {
    switch (action) {
      case "set_spec":
      case "set_plan":
        onPlan(task.id, action);
        return;
      case "open_builder":
        onBuild(task.id);
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
      default:
        return;
    }
  };

  return (
    <div className="mt-3 cursor-default border-t border-border pt-2.5">
      <TaskWorkflowActionGroup
        task={task}
        includeActions={[
          "set_spec",
          "set_plan",
          "build_start",
          "open_builder",
          "human_approve",
          "human_request_changes",
        ]}
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
  activeSessions = [],
  onOpenDetails,
  onDelegate,
  onPlan,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
}: KanbanTaskCardProps): ReactElement {
  const hasActiveSessions = activeSessions.length > 0;

  return (
    <article
      className={cn(
        "group min-w-0 rounded-xl border border-border/90 bg-card/95 shadow-sm transition duration-150 hover:border-sky-200 hover:shadow-md",
        hasActiveSessions
          ? "kanban-active-session-card border-sky-300/80 shadow-sky-200/50"
          : undefined,
      )}
    >
      {hasActiveSessions ? (
        <BorderRay turnDurationMs={2500} className="kanban-active-session-ray" />
      ) : null}

      <div className="kanban-active-session-content flex min-w-0 flex-col space-y-2.5 p-3.5">
        <button
          type="button"
          aria-label={`Open details for ${task.title}`}
          className="flex w-full min-w-0 cursor-pointer items-start justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => onOpenDetails(task.id)}
        >
          <div className="min-w-0 space-y-1">
            <p
              className="line-clamp-2 break-words text-sm font-semibold leading-tight text-foreground"
              title={task.title}
            >
              {task.title}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{task.id}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] text-muted-foreground transition group-hover:border-border group-hover:bg-muted group-hover:text-muted-foreground">
            <ExternalLink className="size-3" />
            Open
          </span>
        </button>

        <TaskMeta task={task} runState={runState} />

        {hasActiveSessions ? (
          <ActiveSessionsLine taskId={task.id} activeSessions={activeSessions} />
        ) : null}

        <TaskActions
          task={task}
          onPlan={onPlan}
          onBuild={onBuild}
          onDelegate={onDelegate}
          {...(onHumanApprove ? { onHumanApprove } : {})}
          {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
        />
      </div>
    </article>
  );
}, areKanbanTaskCardPropsEqual);
