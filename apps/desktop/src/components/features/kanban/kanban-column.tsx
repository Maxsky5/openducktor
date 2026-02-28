import type { RunSummary } from "@openducktor/contracts";
import type { KanbanColumn as KanbanColumnData, KanbanColumnId } from "@openducktor/core";
import { Inbox } from "lucide-react";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildVirtualColumnLayout,
  findVirtualWindowRange,
  getVirtualWindowEdgeOffsets,
  resolveVirtualViewportWindow,
  type VirtualWindowRange,
} from "@/components/features/kanban/kanban-column-virtualization";
import { KanbanTaskCard } from "@/components/features/kanban/kanban-task-card";
import { laneTheme } from "@/components/features/kanban/kanban-theme";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const VIRTUALIZATION_MIN_TASK_COUNT = 30;
const VIRTUAL_CARD_ESTIMATED_HEIGHT_PX = 180;
const VIRTUAL_CARD_GAP_PX = 12;
const VIRTUAL_OVERSCAN_PX = 360;
const INITIAL_VIEWPORT_HEIGHT_FALLBACK_PX = 900;
const EMPTY_ACTIVE_SESSIONS: AgentSessionState[] = [];

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
  activeSessions: AgentSessionState[] | undefined;
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
  const cardsViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = column.tasks.length >= VIRTUALIZATION_MIN_TASK_COUNT;
  const [measuredCardHeightsById, setMeasuredCardHeightsById] = useState<Record<string, number>>(
    {},
  );

  const taskHeights = useMemo(
    () =>
      column.tasks.map(
        (task) => measuredCardHeightsById[task.id] ?? VIRTUAL_CARD_ESTIMATED_HEIGHT_PX,
      ),
    [column.tasks, measuredCardHeightsById],
  );

  const virtualLayout = useMemo(
    () => buildVirtualColumnLayout(taskHeights, VIRTUAL_CARD_GAP_PX),
    [taskHeights],
  );

  const [visibleRange, setVisibleRange] = useState<VirtualWindowRange>(() =>
    findVirtualWindowRange({
      itemOffsets: virtualLayout.itemOffsets,
      itemHeights: taskHeights,
      totalHeight: virtualLayout.totalHeight,
      viewportStart: -VIRTUAL_OVERSCAN_PX,
      viewportEnd:
        (typeof window === "undefined" ? INITIAL_VIEWPORT_HEIGHT_FALLBACK_PX : window.innerHeight) +
        VIRTUAL_OVERSCAN_PX,
    }),
  );

  const syncViewport = useCallback((): void => {
    if (typeof window === "undefined") {
      return;
    }
    const viewportElement = cardsViewportRef.current;
    if (!viewportElement) {
      return;
    }

    const rect = viewportElement.getBoundingClientRect();
    const scrollContainer = viewportElement.closest(
      "[data-main-scroll-container='true']",
    ) as HTMLElement | null;
    const containerRect = scrollContainer?.getBoundingClientRect();
    const viewportHeight = scrollContainer?.clientHeight ?? window.innerHeight;
    const { viewportStart, viewportEnd } = resolveVirtualViewportWindow({
      laneTop: rect.top,
      viewportTop: containerRect?.top ?? 0,
      viewportHeight,
    });
    const nextRange = findVirtualWindowRange({
      itemOffsets: virtualLayout.itemOffsets,
      itemHeights: taskHeights,
      totalHeight: virtualLayout.totalHeight,
      viewportStart: viewportStart - VIRTUAL_OVERSCAN_PX,
      viewportEnd: viewportEnd + VIRTUAL_OVERSCAN_PX,
    });

    setVisibleRange((current) => {
      if (current.startIndex === nextRange.startIndex && current.endIndex === nextRange.endIndex) {
        return current;
      }
      return nextRange;
    });
  }, [taskHeights, virtualLayout.itemOffsets, virtualLayout.totalHeight]);

  const { topSpacerHeight, bottomSpacerHeight } = useMemo(
    () =>
      getVirtualWindowEdgeOffsets({
        range: visibleRange,
        itemOffsets: virtualLayout.itemOffsets,
        itemHeights: taskHeights,
        totalHeight: virtualLayout.totalHeight,
      }),
    [taskHeights, virtualLayout.itemOffsets, virtualLayout.totalHeight, visibleRange],
  );

  useEffect(() => {
    if (!shouldVirtualize || typeof window === "undefined") {
      return;
    }

    const rafRef: { current: number | null } = { current: null };

    const scheduleViewportSync = (): void => {
      if (rafRef.current !== null) {
        return;
      }
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        syncViewport();
      });
    };

    const scrollContainer = cardsViewportRef.current?.closest(
      "[data-main-scroll-container='true']",
    ) as HTMLElement | null;

    scheduleViewportSync();
    window.addEventListener("scroll", scheduleViewportSync, { passive: true });
    window.addEventListener("resize", scheduleViewportSync);
    scrollContainer?.addEventListener("scroll", scheduleViewportSync, { passive: true });

    const viewportElement = cardsViewportRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            scheduleViewportSync();
          });

    if (resizeObserver && viewportElement) {
      resizeObserver.observe(viewportElement);
    }

    return () => {
      window.removeEventListener("scroll", scheduleViewportSync);
      window.removeEventListener("resize", scheduleViewportSync);
      scrollContainer?.removeEventListener("scroll", scheduleViewportSync);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      resizeObserver?.disconnect();
    };
  }, [shouldVirtualize, syncViewport]);

  useEffect(() => {
    if (!shouldVirtualize) {
      return;
    }
    const taskIds = new Set(column.tasks.map((task) => task.id));
    setMeasuredCardHeightsById((current) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [taskId, measuredHeight] of Object.entries(current)) {
        if (taskIds.has(taskId)) {
          next[taskId] = measuredHeight;
          continue;
        }
        changed = true;
      }
      return changed ? next : current;
    });
  }, [column.tasks, shouldVirtualize]);

  const handleMeasuredHeight = useCallback((taskId: string, nextHeight: number): void => {
    setMeasuredCardHeightsById((current) => {
      if (current[taskId] === nextHeight) {
        return current;
      }
      return { ...current, [taskId]: nextHeight };
    });
  }, []);

  const visibleTasks = !shouldVirtualize
    ? column.tasks
    : visibleRange.endIndex >= visibleRange.startIndex
      ? column.tasks.slice(visibleRange.startIndex, visibleRange.endIndex + 1)
      : [];

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
          <>
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
          </>
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
