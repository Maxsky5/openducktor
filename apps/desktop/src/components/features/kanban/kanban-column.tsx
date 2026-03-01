import type { RunSummary } from "@openducktor/contracts";
import type { KanbanColumn as KanbanColumnData, KanbanColumnId } from "@openducktor/core";
import { Inbox } from "lucide-react";
import { type ComponentProps, memo, type ReactElement, useEffect, useRef } from "react";
import { KanbanTaskCard } from "@/components/features/kanban/kanban-task-card";
import { laneTheme } from "@/components/features/kanban/kanban-theme";
import { useKanbanVirtualization } from "@/components/features/kanban/use-kanban-virtualization";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type RunningTaskSessions = NonNullable<ComponentProps<typeof KanbanTaskCard>["activeSessions"]>;
const EMPTY_ACTIVE_SESSIONS: RunningTaskSessions = [];

type KanbanColumnProps = {
  column: KanbanColumnData;
  runStateByTaskId: Map<string, RunSummary["state"]>;
  activeSessionsByTaskId: Map<string, AgentSessionState[]>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
};

const laneCountLabel = (count: number): string => (count === 1 ? "1 task" : `${count} tasks`);

type TaskCardHandlers = Pick<
  KanbanColumnProps,
  "onOpenDetails" | "onDelegate" | "onPlan" | "onBuild" | "onHumanApprove" | "onHumanRequestChanges"
>;

const MeasuredTaskCard = memo(function MeasuredTaskCard({
  task,
  runState,
  activeSessions,
  onMeasuredHeight,
  onOpenDetails,
  onDelegate,
  onPlan,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
}: {
  task: KanbanColumnData["tasks"][number];
  runState: RunSummary["state"] | undefined;
  activeSessions: RunningTaskSessions | undefined;
  onMeasuredHeight: (taskId: string, height: number) => void;
} & TaskCardHandlers): ReactElement {
  const taskWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = taskWrapperRef.current;
    if (!element) {
      return;
    }

    const reportHeight = (): void => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      if (nextHeight > 0) {
        onMeasuredHeight(task.id, nextHeight);
      }
    };

    reportHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      reportHeight();
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [onMeasuredHeight, task.id]);

  return (
    <div ref={taskWrapperRef}>
      <KanbanTaskCard
        task={task}
        runState={runState}
        activeSessions={activeSessions}
        onOpenDetails={onOpenDetails}
        onDelegate={onDelegate}
        onPlan={onPlan}
        onBuild={onBuild}
        {...(onHumanApprove ? { onHumanApprove } : {})}
        {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
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
  activeSessionsByTaskId,
  onOpenDetails,
  onDelegate,
  onPlan,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
}: KanbanColumnProps): ReactElement {
  const theme = laneTheme(column.id);
  const {
    containerRef: cardsViewportRef,
    shouldVirtualize,
    totalHeight,
    topSpacerHeight,
    bottomSpacerHeight,
    visibleTasks,
    onMeasuredHeight: handleMeasuredHeight,
  } = useKanbanVirtualization({
    tasks: column.tasks,
  });

  return (
    <section
      className={cn(
        "flex w-[328px] min-w-[328px] flex-col overflow-hidden rounded-2xl border shadow-sm",
        theme.boardSurfaceClass,
      )}
    >
      <LaneHeader id={column.id} title={column.title} count={column.tasks.length} />
      <div ref={cardsViewportRef} className="flex-1 p-3">
        {column.tasks.length === 0 ? <LaneEmptyState id={column.id} /> : null}

        {column.tasks.length > 0 && shouldVirtualize ? (
          <div style={{ minHeight: totalHeight }}>
            {topSpacerHeight > 0 ? <div style={{ height: topSpacerHeight }} /> : null}
            <div className="space-y-3">
              {visibleTasks.map((task) => (
                <MeasuredTaskCard
                  key={task.id}
                  task={task}
                  runState={runStateByTaskId.get(task.id)}
                  activeSessions={activeSessionsByTaskId.get(task.id) ?? EMPTY_ACTIVE_SESSIONS}
                  onMeasuredHeight={handleMeasuredHeight}
                  onOpenDetails={onOpenDetails}
                  onDelegate={onDelegate}
                  onPlan={onPlan}
                  onBuild={onBuild}
                  {...(onHumanApprove ? { onHumanApprove } : {})}
                  {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
                />
              ))}
            </div>
            {bottomSpacerHeight > 0 ? <div style={{ height: bottomSpacerHeight }} /> : null}
          </div>
        ) : null}

        {column.tasks.length > 0 && !shouldVirtualize ? (
          <div className="space-y-3">
            {column.tasks.map((task) => (
              <KanbanTaskCard
                key={task.id}
                task={task}
                runState={runStateByTaskId.get(task.id)}
                activeSessions={activeSessionsByTaskId.get(task.id) ?? EMPTY_ACTIVE_SESSIONS}
                onOpenDetails={onOpenDetails}
                onDelegate={onDelegate}
                onPlan={onPlan}
                onBuild={onBuild}
                {...(onHumanApprove ? { onHumanApprove } : {})}
                {...(onHumanRequestChanges ? { onHumanRequestChanges } : {})}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
