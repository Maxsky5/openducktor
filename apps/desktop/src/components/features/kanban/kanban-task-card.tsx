import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { ExternalLink, PlayCircle, Tag } from "lucide-react";
import { memo, type ReactElement, useId, useLayoutEffect, useRef, useState } from "react";
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
import {
  resolveHistoricalSessionRoles,
  resolvePreferredActiveSession,
  resolveSessionTargetOptions,
} from "@/components/features/kanban/session-target-resolution";
import { TaskWorkflowActionGroup } from "@/components/features/kanban/task-workflow-action-group";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { TaskLabelChip } from "@/components/features/tasks/task-label-chip";
import { Badge } from "@/components/ui/badge";
import { BorderRay } from "@/components/ui/border-ray";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toDisplayTaskLabels } from "@/lib/task-labels";
import { cn } from "@/lib/utils";
import { AGENT_ROLE_LABELS } from "@/types";

const LABEL_ROW_EPSILON_PX = 1;
const DEFAULT_FLEX_GAP_PX = 6;

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
  hasActiveSession?: boolean;
  activeSessionRole?: AgentRole;
  taskActivityState: KanbanTaskActivityState;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession?: (
    taskId: string,
    role: AgentRole,
    options?: { sessionId?: string | null; scenario?: AgentScenario | null },
  ) => void;
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
  areTaskAgentSessionsEqual(left.agentSessions, right.agentSessions) &&
  areStringArraysEqual(left.availableActions, right.availableActions);

const areTaskAgentSessionsEqual = (
  left: TaskCard["agentSessions"] | undefined,
  right: TaskCard["agentSessions"] | undefined,
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
      leftSession.sessionId !== rightSession.sessionId ||
      leftSession.role !== rightSession.role ||
      leftSession.scenario !== rightSession.scenario ||
      leftSession.startedAt !== rightSession.startedAt
    ) {
      return false;
    }
  }

  return true;
};

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
  previous.hasActiveSession === next.hasActiveSession &&
  previous.activeSessionRole === next.activeSessionRole &&
  previous.taskActivityState === next.taskActivityState &&
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

  if (session.status === "starting") {
    return "Starting";
  }

  return "Running";
};

const getSessionStatusTextClassName = (isWaitingInput: boolean): string => {
  if (isWaitingInput) {
    return "text-warning-surface-foreground";
  }

  return "text-primary/90";
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

const getFlexGap = (element: HTMLElement): number => {
  const styles = window.getComputedStyle(element);
  const rawGap = styles.columnGap === "normal" ? styles.gap : styles.columnGap;
  const parsedGap = Number.parseFloat(rawGap);
  return Number.isFinite(parsedGap) ? parsedGap : DEFAULT_FLEX_GAP_PX;
};

const isWrappedBelowFirstRow = ({
  container,
  element,
}: {
  container: HTMLElement;
  element: HTMLElement;
}): boolean => {
  const containerTop = container.getBoundingClientRect().top;
  const elementTop = element.getBoundingClientRect().top;
  return elementTop - containerTop > LABEL_ROW_EPSILON_PX;
};

function TaskPrimaryMeta({ task }: { task: TaskCard }): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const taskIdWrapperRef = useRef<HTMLDivElement | null>(null);
  const [isTaskIdWrapped, setIsTaskIdWrapped] = useState(false);
  const taskPrimaryMetaSignature = `${task.id}:${task.issueType}:${task.priority}`;

  useLayoutEffect(() => {
    void taskPrimaryMetaSignature;
    const container = containerRef.current;
    const taskIdWrapper = taskIdWrapperRef.current;

    if (!container || !taskIdWrapper) {
      return undefined;
    }

    const updateWrapState = (): void => {
      const nextWrapped = isWrappedBelowFirstRow({
        container,
        element: taskIdWrapper,
      });
      setIsTaskIdWrapped((currentWrapped) =>
        currentWrapped === nextWrapped ? currentWrapped : nextWrapped,
      );
    };

    updateWrapState();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateWrapState();
    });

    observer.observe(container);
    observer.observe(taskIdWrapper);

    return () => {
      observer.disconnect();
    };
  }, [taskPrimaryMetaSignature]);

  return (
    <div ref={containerRef} className="flex flex-wrap items-center gap-1.5">
      <IssueTypeBadge issueType={task.issueType} />
      <PriorityBadge priority={task.priority} />
      <div
        ref={taskIdWrapperRef}
        className={cn("min-w-0", isTaskIdWrapped ? "basis-full" : "ml-auto")}
      >
        <TaskIdBadge taskId={task.id} />
      </div>
    </div>
  );
}

function TaskSecondaryMeta({
  task,
  runState,
}: {
  task: TaskCard;
  runState: VisibleKanbanRunState | undefined;
}): ReactElement | null {
  const hasSecondaryBadges =
    task.subtaskIds.length > 0 ||
    runState != null ||
    task.pullRequest != null ||
    task.documentSummary.qaReport.verdict === "rejected";

  if (!hasSecondaryBadges) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
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

function TaskLabelOverflowIndicator({ hiddenLabels }: { hiddenLabels: string[] }): ReactElement {
  const hiddenLabelsDescriptionId = useId();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 shrink-0 items-center rounded-md border border-input bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
    </TooltipProvider>
  );
}

function TaskLabelRow({ labels }: { labels: string[] }): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRowRef = useRef<HTMLDivElement | null>(null);
  const overflowMeasureRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(labels.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measureRow = measureRowRef.current;
    const overflowMeasure = overflowMeasureRef.current;

    if (!container || !measureRow || !overflowMeasure) {
      return undefined;
    }

    const updateVisibleCount = (): void => {
      const availableWidth = container.clientWidth;
      if (availableWidth <= 0) {
        setVisibleCount(labels.length);
        return;
      }

      const chipElements = Array.from(measureRow.children) as HTMLElement[];
      const overflowWidth = overflowMeasure.getBoundingClientRect().width;
      const gap = getFlexGap(measureRow);
      let nextVisibleCount = labels.length;
      let usedWidth = 0;

      for (let index = 0; index < chipElements.length; index += 1) {
        const chipElement = chipElements[index];
        const chipWidth = chipElement?.getBoundingClientRect().width ?? 0;
        const nextWidth = usedWidth + (index > 0 ? gap : 0) + chipWidth;
        const hiddenCount = labels.length - (index + 1);
        const reservedOverflowWidth = hiddenCount > 0 ? gap + overflowWidth : 0;

        if (nextWidth + reservedOverflowWidth <= availableWidth + LABEL_ROW_EPSILON_PX) {
          usedWidth = nextWidth;
          continue;
        }

        nextVisibleCount = index;
        break;
      }

      setVisibleCount((currentVisibleCount) =>
        currentVisibleCount === nextVisibleCount ? currentVisibleCount : nextVisibleCount,
      );
    };

    updateVisibleCount();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateVisibleCount();
    });

    observer.observe(container);
    observer.observe(measureRow);
    observer.observe(overflowMeasure);

    return () => {
      observer.disconnect();
    };
  }, [labels]);

  const hiddenLabels = labels.slice(visibleCount);

  return (
    <div className="relative min-w-0">
      <div
        ref={containerRef}
        className="flex min-w-0 items-center gap-1.5 overflow-hidden"
        data-testid="kanban-task-label-row"
      >
        {labels.slice(0, visibleCount).map((label) => (
          <TaskLabelChip key={label} label={label} className="min-w-0 max-w-full shrink" />
        ))}
        {hiddenLabels.length > 0 ? (
          <TaskLabelOverflowIndicator hiddenLabels={hiddenLabels} />
        ) : null}
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 invisible flex items-center gap-1.5 overflow-hidden"
        aria-hidden="true"
      >
        <div ref={measureRowRef} className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {labels.map((label) => (
            <div key={label} className="min-w-0">
              <TaskLabelChip label={label} className="min-w-0 max-w-full shrink" />
            </div>
          ))}
        </div>
        <div ref={overflowMeasureRef}>
          <span className="inline-flex h-6 items-center rounded-md border border-input bg-muted px-2 py-0.5 text-xs font-medium">
            +{labels.length}
          </span>
        </div>
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
  const displayLabels = toDisplayTaskLabels(task.labels);

  return (
    <div className="flex flex-col gap-2">
      <TaskPrimaryMeta task={task} />
      {displayLabels.length > 0 ? <TaskLabelRow labels={displayLabels} /> : null}
      <TaskSecondaryMeta task={task} runState={runState} />
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
  onOpenSession,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
  taskSessions,
  hasActiveSession,
  activeSessionRole,
  taskActivityState,
}: {
  task: TaskCard;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart?: (taskId: string) => void;
  onQaOpen?: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession?: (
    taskId: string,
    role: AgentRole,
    options?: { sessionId?: string | null; scenario?: AgentScenario | null },
  ) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
  onResetImplementation?: (taskId: string) => void;
  taskSessions: KanbanTaskSession[];
  hasActiveSession: boolean;
  activeSessionRole?: AgentRole;
  taskActivityState: KanbanTaskActivityState;
}): ReactElement | null {
  const includeActions: readonly TaskWorkflowAction[] = [
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
  const historicalSessionRoles = resolveHistoricalSessionRoles(task);
  const workflowActions = resolveTaskCardActions(task, {
    include: includeActions,
    hasActiveSession,
    ...(activeSessionRole ? { activeSessionRole } : {}),
    historicalSessionRoles,
  });

  if (workflowActions.allActions.length === 0) {
    return null;
  }

  const primaryActiveSession =
    hasActiveSession && activeSessionRole
      ? resolvePreferredActiveSession(taskSessions, activeSessionRole)
      : null;
  const primarySessionIsWaitingInput =
    primaryActiveSession?.presentationState === "waiting_input" ||
    (taskActivityState === "waiting_input" && hasActiveSession);

  const openRoleSession = (role: AgentRole): void => {
    const sessionOptions = resolveSessionTargetOptions(task, taskSessions, role);

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
    <div className="mt-3 cursor-default border-t border-border pt-2.5">
      <TaskWorkflowActionGroup
        task={task}
        includeActions={includeActions}
        hasActiveSession={hasActiveSession}
        {...(activeSessionRole ? { activeSessionRole } : {})}
        historicalSessionRoles={historicalSessionRoles}
        onAction={runAction}
        size="sm"
        expandPrimary
        compactMenuTrigger
        primaryClassName={cn(
          hasActiveSession
            ? [
                "h-9 rounded-lg px-2 py-1 text-[11px] font-semibold shadow-none",
                getSessionChipClassName(primarySessionIsWaitingInput),
              ]
            : "h-9 rounded-lg font-semibold shadow-sm",
        )}
        primaryContent={
          hasActiveSession && primaryActiveSession ? (
            <>
              <PlayCircle className="size-3" />
              {AGENT_ROLE_LABELS[primaryActiveSession.role] ?? primaryActiveSession.role}
              <span
                className={cn(
                  "text-[10px] font-medium",
                  getSessionStatusTextClassName(primarySessionIsWaitingInput),
                )}
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
  runState,
  taskSessions = [],
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
  const visibleRunState = toVisibleKanbanRunState(runState);
  const cardActivityClassName = getCardActivityClassName({
    hasActiveSession: hasActiveSessionValue,
    isWaitingInput,
  });

  return (
    <article
      className={cn(
        "group min-w-0 rounded-xl border border-border/90 bg-card/95 shadow-sm transition duration-150 hover:border-info-border hover:shadow-md",
        cardActivityClassName,
      )}
    >
      {hasActiveSessionValue && !isWaitingInput ? (
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
          <div className="min-w-0 flex-1">
            <p
              className="line-clamp-2 break-words text-sm font-semibold leading-tight text-foreground"
              title={task.title}
            >
              {task.title}
            </p>
          </div>
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition group-hover:border-border group-hover:bg-muted group-hover:text-muted-foreground"
            data-testid="kanban-open-details-affordance"
          >
            <ExternalLink className="size-3" />
          </span>
        </div>
        <TaskMeta task={task} runState={visibleRunState} />
        <TaskActions
          task={task}
          taskSessions={taskSessions}
          hasActiveSession={hasActiveSessionValue}
          {...(activeSessionRole ? { activeSessionRole } : {})}
          taskActivityState={taskActivityState}
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
