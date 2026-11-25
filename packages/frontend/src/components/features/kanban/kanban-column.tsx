import type { KanbanColumn as KanbanColumnData } from "@openducktor/workflows";
import type { KanbanTaskCardView } from "@openducktor/contracts";
import { getRequiredTaskActivityState } from "@openducktor/frontend-core/tasks/board/kanban-board-sessions";
import type { MixedBoard } from "@openducktor/frontend-core/tasks/board/use-kanban-board-data";
import { Inbox } from "lucide-react";
import { type ComponentProps, memo, type ReactElement, useEffect, useMemo, useRef } from "react";
import {
  KANBAN_LANE_HEADER_HEIGHT_CLASS,
  KANBAN_LANE_WIDTH_CLASS,
} from "@/components/features/kanban/kanban-layout";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import { KanbanTaskCard } from "@/components/features/kanban/kanban-task-card";
import { laneTheme } from "@/components/features/kanban/kanban-theme";
import {
  getCardLayout,
  type WorkflowPendingState,
} from "@openducktor/frontend-core/tasks/board/kanban-task-footer";
import { useKanbanVirtualization } from "@/components/features/kanban/use-kanban-virtualization";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { columnWorkflowsText } from "./kanban-column-workflows";

type CardProps = ComponentProps<typeof KanbanTaskCard>;
type TaskSessions = NonNullable<CardProps["taskSessions"]>;
type HistoricalSessions = NonNullable<CardProps["historicalSessions"]>;
const EMPTY_TASK_SESSIONS: TaskSessions = [];
const EMPTY_HISTORICAL_SESSIONS: HistoricalSessions = [];

type KanbanColumnProps = {
  column: KanbanColumnData;
  taskCardView?: KanbanTaskCardView;
  /** A board of several workflows: cards of other workflows and the header name them. */
  mixedBoard?: MixedBoard | null;
  pendingState?: WorkflowPendingState | undefined;
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  historicalSessionsByTaskId: Map<string, HistoricalSessions>;
  mergedTargetByTaskId: ReadonlyMap<string, string>;
  autoCloseFailureByTaskId: ReadonlyMap<string, string>;
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>;
  onOpenDetails: (taskId: string) => void;
};

export function KanbanColumn({
  column,
  taskCardView = "normal",
  mixedBoard = null,
  pendingState,
  taskSessionsByTaskId,
  historicalSessionsByTaskId,
  mergedTargetByTaskId,
  autoCloseFailureByTaskId,
  activeTaskSessionContextByTaskId,
  taskActivityStateByTaskId,
  onOpenDetails,
}: KanbanColumnProps): ReactElement {
  const theme = laneTheme(column.tone);
  const cardLayoutsByTaskId = useMemo(
    () =>
      new Map(
        column.tasks.map((task) => {
          const context = activeTaskSessionContextByTaskId.get(task.id);
          const inputs = {
            task,
            taskSessions: taskSessionsByTaskId.get(task.id) ?? EMPTY_TASK_SESSIONS,
            historicalSessions:
              historicalSessionsByTaskId.get(task.id) ?? EMPTY_HISTORICAL_SESSIONS,
            hasActiveSession: Boolean(context),
            activeSessionRole: context?.role,
            taskActivityState: getRequiredTaskActivityState(taskActivityStateByTaskId, task.id),
            pendingState,
            mergedTarget: mergedTargetByTaskId.get(task.id),
            autoCloseFailure: autoCloseFailureByTaskId.get(task.id),
          };
          return [task.id, getCardLayout(inputs)];
        }),
      ),
    [
      column.tasks,
      activeTaskSessionContextByTaskId,
      taskSessionsByTaskId,
      historicalSessionsByTaskId,
      mergedTargetByTaskId,
      autoCloseFailureByTaskId,
      taskActivityStateByTaskId,
      pendingState,
    ],
  );
  const {
    containerRef: cardsViewportRef,
    renderModel,
    measurementVersion,
    onMeasuredHeight: handleMeasuredHeight,
  } = useKanbanVirtualization({
    tasks: column.tasks,
    taskCardView,
    cardLayoutsByTaskId,
  });
  const isVirtualized = renderModel.kind === "virtualized";
  const renderCard = (task: KanbanColumnData["tasks"][number]): ReactElement => {
    const context = activeTaskSessionContextByTaskId.get(task.id);
    const cardProps: CardProps = {
      task,
      taskCardView,
      pendingState,
      taskSessions: taskSessionsByTaskId.get(task.id) ?? EMPTY_TASK_SESSIONS,
      historicalSessions: historicalSessionsByTaskId.get(task.id) ?? EMPTY_HISTORICAL_SESSIONS,
      hasActiveSession: Boolean(context),
      taskActivityState: getRequiredTaskActivityState(taskActivityStateByTaskId, task.id),
      onOpenDetails,
    };
    if (context?.role) cardProps.activeSessionRole = context.role;
    const mergedTarget = mergedTargetByTaskId.get(task.id);
    if (mergedTarget !== undefined) cardProps.mergedTarget = mergedTarget;
    const autoCloseFailure = autoCloseFailureByTaskId.get(task.id);
    if (autoCloseFailure !== undefined) cardProps.autoCloseFailure = autoCloseFailure;
    if (!isVirtualized) return <KanbanTaskCard key={task.id} {...cardProps} />;
    return (
      <MeasuredCard
        key={task.id}
        {...cardProps}
        contentRevision={cardLayoutsByTaskId.get(task.id)!.contentRevision}
        measurementVersion={measurementVersion}
        onMeasuredHeight={handleMeasuredHeight}
      />
    );
  };
  let cards = <div className="space-y-3">{renderModel.visibleTasks.map(renderCard)}</div>;
  if (isVirtualized) {
    cards = (
      <div style={{ minHeight: renderModel.totalHeight }}>
        {renderModel.topSpacerHeight > 0 ? (
          <div style={{ height: renderModel.topSpacerHeight }} />
        ) : null}
        {cards}
        {renderModel.bottomSpacerHeight > 0 ? (
          <div style={{ height: renderModel.bottomSpacerHeight }} />
        ) : null}
      </div>
    );
  }

  return (
    <section
      tabIndex={-1}
      aria-label={`${column.title} lane`}
      data-kanban-lane-id={column.id}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        KANBAN_LANE_WIDTH_CLASS,
        theme.boardSurfaceClass,
      )}
    >
      <LaneHeader
        theme={theme}
        title={column.title}
        count={column.tasks.length}
        workflows={mixedBoard?.columnWorkflows.get(column.id) ?? null}
      />
      <div ref={cardsViewportRef} className="flex-1 p-3">
        {column.tasks.length === 0 ? <LaneEmptyState theme={theme} /> : null}

        {column.tasks.length > 0 ? cards : null}
      </div>
    </section>
  );
}

const laneCountLabel = (count: number): string => (count === 1 ? "1 task" : `${count} tasks`);

type MeasuredCardProps = CardProps & {
  contentRevision: string;
  measurementVersion: number;
  onMeasuredHeight: (taskId: string, height: number) => void;
};

const MeasuredCard = memo(function MeasuredCard({
  contentRevision,
  measurementVersion,
  onMeasuredHeight,
  ...cardProps
}: MeasuredCardProps): ReactElement {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const taskId = cardProps.task.id;

  // Content and density changes need a fresh DOM height even when the task stays in place.
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return;
    }

    const reportHeight = (): void => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      if (nextHeight > 0) {
        onMeasuredHeight(taskId, nextHeight);
      }
    };

    if (globalThis.window === undefined) {
      reportHeight();
      return;
    }

    const frameHandle = window.requestAnimationFrame(() => {
      reportHeight();
    });

    return () => {
      window.cancelAnimationFrame(frameHandle);
    };
  }, [contentRevision, measurementVersion, cardProps.taskCardView, onMeasuredHeight, taskId]);

  return (
    <div ref={wrapperRef}>
      <KanbanTaskCard {...cardProps} />
    </div>
  );
});

type KanbanLaneTheme = ReturnType<typeof laneTheme>;

function LaneHeader({
  theme,
  title,
  count,
  workflows,
}: {
  theme: KanbanLaneTheme;
  title: string;
  count: number;
  /** The workflows that use the column, on a board of several workflows. */
  workflows: readonly string[] | null;
}): ReactElement {
  const heading = (
    <h3 className="min-w-0 truncate text-sm font-semibold uppercase tracking-wide text-foreground">
      {title}
      {workflows ? <span className="sr-only">. {columnWorkflowsText(workflows)}</span> : null}
    </h3>
  );
  return (
    <header
      className={cn(
        "flex flex-col justify-between border-b border-border/80 px-4 pb-3 pt-4",
        KANBAN_LANE_HEADER_HEIGHT_CLASS,
        theme.headerSurfaceClass,
      )}
    >
      <span className={cn("block h-1.5 w-14 rounded-full", theme.headerAccentClass)} />
      <div className="flex items-center justify-between gap-2">
        {workflows ? (
          <Tooltip>
            <TooltipTrigger asChild>{heading}</TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {columnWorkflowsText(workflows)}
            </TooltipContent>
          </Tooltip>
        ) : (
          heading
        )}
        <Badge
          variant="outline"
          className={cn(
            "h-6 shrink-0 rounded-full px-2 text-[11px] font-semibold",
            theme.countBadgeClass,
          )}
        >
          {laneCountLabel(count)}
        </Badge>
      </div>
    </header>
  );
}

function LaneEmptyState({ theme }: { theme: KanbanLaneTheme }): ReactElement {
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
