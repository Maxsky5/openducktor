import type { RunSummary } from "@openducktor/contracts";
import type {
  AgentRole,
  AgentScenario,
  KanbanColumn as KanbanColumnData,
  KanbanColumnId,
} from "@openducktor/core";
import { Inbox } from "lucide-react";
import { type ComponentProps, memo, type ReactElement, useEffect, useRef } from "react";
import { KANBAN_LANE_WIDTH_CLASS } from "@/components/features/kanban/kanban-layout";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import { KanbanTaskCard } from "@/components/features/kanban/kanban-task-card";
import { laneTheme } from "@/components/features/kanban/kanban-theme";
import { useKanbanVirtualization } from "@/components/features/kanban/use-kanban-virtualization";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type TaskSessions = NonNullable<ComponentProps<typeof KanbanTaskCard>["taskSessions"]>;
const EMPTY_TASK_SESSIONS: TaskSessions = [];

type KanbanColumnProps = {
  column: KanbanColumnData;
  runStateByTaskId: Map<string, RunSummary["state"]>;
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession: (
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

const laneCountLabel = (count: number): string => (count === 1 ? "1 task" : `${count} tasks`);

const getRequiredTaskActivityState = (
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>,
  taskId: string,
): KanbanTaskActivityState => {
  const taskActivityState = taskActivityStateByTaskId.get(taskId);
  if (!taskActivityState) {
    throw new Error(`Missing Kanban task activity state for task ${taskId}`);
  }

  return taskActivityState;
};

type TaskCardHandlers = Pick<
  KanbanColumnProps,
  | "onOpenDetails"
  | "onDelegate"
  | "onOpenSession"
  | "onPlan"
  | "onQaStart"
  | "onQaOpen"
  | "onBuild"
  | "onHumanApprove"
  | "onHumanRequestChanges"
  | "onResetImplementation"
>;

const MeasuredTaskCard = memo(function MeasuredTaskCard({
  task,
  runState,
  taskSessions,
  hasActiveSession,
  activeSessionRole,
  activeSessionPresentationState,
  taskActivityState,
  measurementVersion,
  onMeasuredHeight,
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
}: {
  task: KanbanColumnData["tasks"][number];
  runState: RunSummary["state"] | undefined;
  taskSessions: TaskSessions | undefined;
  hasActiveSession: boolean;
  activeSessionRole: AgentRole | undefined;
  activeSessionPresentationState: KanbanTaskSession["presentationState"] | undefined;
  taskActivityState: KanbanTaskActivityState;
  measurementVersion: number;
  onMeasuredHeight: (taskId: string, height: number) => void;
} & TaskCardHandlers): ReactElement {
  const taskWrapperRef = useRef<HTMLDivElement | null>(null);
  const taskMeasurementKey = [
    task.updatedAt ?? "",
    task.title,
    task.status,
    task.issueType,
    task.priority,
    task.subtaskIds.join(","),
    task.availableActions.join(","),
    task.pullRequest?.number ?? "",
    task.pullRequest?.state ?? "",
    task.pullRequest?.url ?? "",
  ].join("|");
  const taskSessionsMeasurementKey =
    taskSessions
      ?.map(
        (session) =>
          `${session.sessionId}:${session.role}:${session.scenario}:${session.status}:${session.presentationState}`,
      )
      .join("|") ?? "";
  const measurementTrigger = [
    measurementVersion,
    runState ?? "",
    taskActivityState,
    taskMeasurementKey,
    taskSessionsMeasurementKey,
    hasActiveSession ? "active" : "idle",
    activeSessionRole ?? "",
    activeSessionPresentationState ?? "",
  ].join("::");

  useEffect(() => {
    const element = taskWrapperRef.current;
    if (!element) {
      return;
    }

    if (measurementTrigger.length === 0) {
      return;
    }

    const reportHeight = (): void => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      if (nextHeight > 0) {
        onMeasuredHeight(task.id, nextHeight);
      }
    };

    if (typeof window === "undefined") {
      reportHeight();
      return;
    }

    const frameHandle = window.requestAnimationFrame(() => {
      reportHeight();
    });

    return () => {
      window.cancelAnimationFrame(frameHandle);
    };
  }, [measurementTrigger, onMeasuredHeight, task.id]);

  return (
    <div ref={taskWrapperRef}>
      <KanbanTaskCard
        task={task}
        runState={runState}
        taskSessions={taskSessions}
        hasActiveSession={hasActiveSession}
        {...(activeSessionRole ? { activeSessionRole } : {})}
        taskActivityState={taskActivityState}
        onOpenDetails={onOpenDetails}
        onDelegate={onDelegate}
        onOpenSession={onOpenSession}
        onPlan={onPlan}
        onBuild={onBuild}
        {...(onQaStart ? { onQaStart } : {})}
        {...(onQaOpen ? { onQaOpen } : {})}
        {...(onHumanApprove ? { onHumanApprove } : {})}
        {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
        {...(onResetImplementation ? { onResetImplementation } : {})}
      />
    </div>
  );
});

function LaneHeader({
  id,
  title,
  count,
}: {
  id: KanbanColumnId;
  title: string;
  count: number;
}): ReactElement {
  const theme = laneTheme(id);
  return (
    <header
      className={cn("space-y-3 border-b border-border/80 px-4 pb-3 pt-4", theme.headerSurfaceClass)}
    >
      <span className={cn("block h-1.5 w-14 rounded-full", theme.headerAccentClass)} />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h3>
        <Badge
          variant="outline"
          className={cn("h-6 rounded-full px-2 text-[11px] font-semibold", theme.countBadgeClass)}
        >
          {laneCountLabel(count)}
        </Badge>
      </div>
    </header>
  );
}

function LaneEmptyState({ id }: { id: KanbanColumnId }): ReactElement {
  const theme = laneTheme(id);
  return (
    <div
      className={cn(
        "flex min-h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 text-center",
        theme.emptyStateClass,
      )}
    >
      <Inbox className="size-4 opacity-70" />
      <p className="text-xs font-medium">No tasks in this lane.</p>
    </div>
  );
}

export function KanbanColumn({
  column,
  runStateByTaskId,
  taskSessionsByTaskId,
  activeTaskSessionContextByTaskId,
  taskActivityStateByTaskId,
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
}: KanbanColumnProps): ReactElement {
  const theme = laneTheme(column.id);
  const {
    containerRef: cardsViewportRef,
    renderModel,
    measurementVersion,
    onMeasuredHeight: handleMeasuredHeight,
  } = useKanbanVirtualization({
    tasks: column.tasks,
  });
  const isVirtualized = renderModel.kind === "virtualized";

  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border shadow-sm",
        KANBAN_LANE_WIDTH_CLASS,
        theme.boardSurfaceClass,
      )}
    >
      <LaneHeader id={column.id} title={column.title} count={column.tasks.length} />
      <div ref={cardsViewportRef} className="flex-1 p-3">
        {column.tasks.length === 0 ? <LaneEmptyState id={column.id} /> : null}

        {column.tasks.length > 0 && isVirtualized ? (
          <div style={{ minHeight: renderModel.totalHeight }}>
            {renderModel.topSpacerHeight > 0 ? (
              <div style={{ height: renderModel.topSpacerHeight }} />
            ) : null}
            <div className="space-y-3">
              {renderModel.visibleTasks.map((task) => {
                const activeSessionContext = activeTaskSessionContextByTaskId.get(task.id);
                return (
                  <MeasuredTaskCard
                    key={task.id}
                    task={task}
                    runState={runStateByTaskId.get(task.id)}
                    taskSessions={taskSessionsByTaskId.get(task.id) ?? EMPTY_TASK_SESSIONS}
                    hasActiveSession={Boolean(activeSessionContext)}
                    activeSessionRole={activeSessionContext?.role}
                    activeSessionPresentationState={activeSessionContext?.presentationState}
                    taskActivityState={getRequiredTaskActivityState(
                      taskActivityStateByTaskId,
                      task.id,
                    )}
                    measurementVersion={measurementVersion}
                    onMeasuredHeight={handleMeasuredHeight}
                    onOpenDetails={onOpenDetails}
                    onDelegate={onDelegate}
                    onOpenSession={onOpenSession}
                    onPlan={onPlan}
                    onBuild={onBuild}
                    {...(onQaStart ? { onQaStart } : {})}
                    {...(onQaOpen ? { onQaOpen } : {})}
                    {...(onHumanApprove ? { onHumanApprove } : {})}
                    {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
                    {...(onResetImplementation ? { onResetImplementation } : {})}
                  />
                );
              })}
            </div>
            {renderModel.bottomSpacerHeight > 0 ? (
              <div style={{ height: renderModel.bottomSpacerHeight }} />
            ) : null}
          </div>
        ) : null}

        {column.tasks.length > 0 && !isVirtualized ? (
          <div className="space-y-3">
            {renderModel.visibleTasks.map((task) => {
              const activeSessionContext = activeTaskSessionContextByTaskId.get(task.id);
              return (
                <KanbanTaskCard
                  key={task.id}
                  task={task}
                  runState={runStateByTaskId.get(task.id)}
                  taskSessions={taskSessionsByTaskId.get(task.id) ?? EMPTY_TASK_SESSIONS}
                  hasActiveSession={Boolean(activeSessionContext)}
                  {...(activeSessionContext?.role
                    ? { activeSessionRole: activeSessionContext.role }
                    : {})}
                  taskActivityState={getRequiredTaskActivityState(
                    taskActivityStateByTaskId,
                    task.id,
                  )}
                  onOpenDetails={onOpenDetails}
                  onDelegate={onDelegate}
                  onOpenSession={onOpenSession}
                  onPlan={onPlan}
                  onBuild={onBuild}
                  {...(onQaStart ? { onQaStart } : {})}
                  {...(onQaOpen ? { onQaOpen } : {})}
                  {...(onHumanApprove ? { onHumanApprove } : {})}
                  {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
                  {...(onResetImplementation ? { onResetImplementation } : {})}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
