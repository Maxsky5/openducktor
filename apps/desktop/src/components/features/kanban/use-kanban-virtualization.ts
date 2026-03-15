import type { KanbanColumn as KanbanColumnData } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildVirtualColumnLayout,
  findVirtualWindowRange,
  getVirtualWindowEdgeOffsets,
  resolveVirtualViewportWindow,
  type VirtualWindowRange,
} from "@/components/features/kanban/kanban-column-virtualization";

const VIRTUALIZATION_MIN_TASK_COUNT = 30;
const VIRTUAL_CARD_ESTIMATED_HEIGHT_PX = 180;
const VIRTUAL_CARD_GAP_PX = 12;
const VIRTUAL_OVERSCAN_PX = 360;
const INITIAL_VIEWPORT_HEIGHT_FALLBACK_PX = 900;
const EMPTY_RANGE: VirtualWindowRange = { startIndex: 0, endIndex: -1 };

type UseKanbanVirtualizationArgs = {
  tasks: KanbanColumnData["tasks"];
};

type KanbanVirtualizedRenderModel = {
  kind: "virtualized";
  totalHeight: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  visibleTasks: KanbanColumnData["tasks"];
};

type KanbanSimpleRenderModel = {
  kind: "simple";
  visibleTasks: KanbanColumnData["tasks"];
};

type KanbanVirtualizationRenderModel = KanbanSimpleRenderModel | KanbanVirtualizedRenderModel;

type UseKanbanVirtualizationResult = {
  containerRef: { current: HTMLDivElement | null };
  renderModel: KanbanVirtualizationRenderModel;
  onMeasuredHeight: (taskId: string, height: number) => void;
};

type VirtualLayoutSnapshot = {
  itemOffsets: number[];
  itemHeights: number[];
  totalHeight: number;
};

export function useKanbanVirtualization({
  tasks,
}: UseKanbanVirtualizationArgs): UseKanbanVirtualizationResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredHeightsByTaskId, setMeasuredHeightsByTaskId] = useState<Record<string, number>>(
    {},
  );
  const shouldVirtualize = tasks.length >= VIRTUALIZATION_MIN_TASK_COUNT;

  const itemHeights = useMemo(() => {
    if (!shouldVirtualize) {
      return [];
    }

    return tasks.map(
      (task) => measuredHeightsByTaskId[task.id] ?? VIRTUAL_CARD_ESTIMATED_HEIGHT_PX,
    );
  }, [measuredHeightsByTaskId, shouldVirtualize, tasks]);

  const virtualLayout = useMemo(
    () => buildVirtualColumnLayout(itemHeights, VIRTUAL_CARD_GAP_PX),
    [itemHeights],
  );
  const virtualLayoutSyncToken = useMemo(
    () => `${tasks.length}:${virtualLayout.totalHeight}:${itemHeights.join(",")}`,
    [itemHeights, tasks.length, virtualLayout.totalHeight],
  );

  const layoutRef = useRef<VirtualLayoutSnapshot>({
    itemOffsets: virtualLayout.itemOffsets,
    itemHeights,
    totalHeight: virtualLayout.totalHeight,
  });
  useEffect(() => {
    layoutRef.current = {
      itemOffsets: virtualLayout.itemOffsets,
      itemHeights,
      totalHeight: virtualLayout.totalHeight,
    };
  }, [itemHeights, virtualLayout.itemOffsets, virtualLayout.totalHeight]);

  const [visibleRange, setVisibleRange] = useState<VirtualWindowRange>(() =>
    findVirtualWindowRange({
      itemOffsets: virtualLayout.itemOffsets,
      itemHeights,
      totalHeight: virtualLayout.totalHeight,
      viewportStart: -VIRTUAL_OVERSCAN_PX,
      viewportEnd:
        (typeof window === "undefined" ? INITIAL_VIEWPORT_HEIGHT_FALLBACK_PX : window.innerHeight) +
        VIRTUAL_OVERSCAN_PX,
    }),
  );

  const syncViewportRef = useRef<() => void>(() => {});
  useEffect(() => {
    syncViewportRef.current = () => {
      if (!shouldVirtualize || typeof window === "undefined") {
        return;
      }

      const viewportElement = containerRef.current;
      if (!viewportElement) {
        return;
      }

      const { itemOffsets, itemHeights: latestItemHeights, totalHeight } = layoutRef.current;
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
        itemOffsets,
        itemHeights: latestItemHeights,
        totalHeight,
        viewportStart: viewportStart - VIRTUAL_OVERSCAN_PX,
        viewportEnd: viewportEnd + VIRTUAL_OVERSCAN_PX,
      });

      setVisibleRange((current) => {
        if (
          current.startIndex === nextRange.startIndex &&
          current.endIndex === nextRange.endIndex
        ) {
          return current;
        }

        return nextRange;
      });
    };
  }, [shouldVirtualize]);

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
        syncViewportRef.current();
      });
    };

    const scrollContainer = containerRef.current?.closest(
      "[data-main-scroll-container='true']",
    ) as HTMLElement | null;

    scheduleViewportSync();
    window.addEventListener("scroll", scheduleViewportSync, { passive: true });
    window.addEventListener("resize", scheduleViewportSync);
    scrollContainer?.addEventListener("scroll", scheduleViewportSync, { passive: true });

    const viewportElement = containerRef.current;
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
  }, [shouldVirtualize]);

  useEffect(() => {
    if (shouldVirtualize) {
      return;
    }

    setVisibleRange((current) =>
      current.startIndex === EMPTY_RANGE.startIndex && current.endIndex === EMPTY_RANGE.endIndex
        ? current
        : EMPTY_RANGE,
    );
  }, [shouldVirtualize]);

  useEffect(() => {
    if (!shouldVirtualize) {
      return;
    }

    if (virtualLayoutSyncToken.length === 0) {
      return;
    }

    syncViewportRef.current();
  }, [shouldVirtualize, virtualLayoutSyncToken]);

  useEffect(() => {
    const taskIds = new Set(tasks.map((task) => task.id));
    setMeasuredHeightsByTaskId((current) => {
      let changed = false;
      const next: Record<string, number> = {};

      for (const [taskId, measuredHeight] of Object.entries(current)) {
        if (!taskIds.has(taskId)) {
          changed = true;
          continue;
        }
        next[taskId] = measuredHeight;
      }

      return changed ? next : current;
    });
  }, [tasks]);

  const onMeasuredHeight = useCallback((taskId: string, nextHeight: number): void => {
    if (nextHeight <= 0) {
      return;
    }

    setMeasuredHeightsByTaskId((current) => {
      if (current[taskId] === nextHeight) {
        return current;
      }

      return { ...current, [taskId]: nextHeight };
    });
  }, []);

  const visibleTasks = useMemo<KanbanColumnData["tasks"]>(() => {
    if (!shouldVirtualize) {
      return tasks;
    }

    if (visibleRange.endIndex < visibleRange.startIndex) {
      return [];
    }

    return tasks.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
  }, [shouldVirtualize, tasks, visibleRange]);

  const virtualSpacerOffsets = useMemo(() => {
    if (!shouldVirtualize) {
      return { topSpacerHeight: 0, bottomSpacerHeight: 0 };
    }

    return getVirtualWindowEdgeOffsets({
      range: visibleRange,
      itemOffsets: virtualLayout.itemOffsets,
      itemHeights,
      totalHeight: virtualLayout.totalHeight,
    });
  }, [
    shouldVirtualize,
    itemHeights,
    virtualLayout.itemOffsets,
    virtualLayout.totalHeight,
    visibleRange,
  ]);

  const renderModel = useMemo<KanbanVirtualizationRenderModel>(() => {
    if (!shouldVirtualize) {
      return {
        kind: "simple",
        visibleTasks: tasks,
      };
    }

    return {
      kind: "virtualized",
      totalHeight: virtualLayout.totalHeight,
      topSpacerHeight: virtualSpacerOffsets.topSpacerHeight,
      bottomSpacerHeight: virtualSpacerOffsets.bottomSpacerHeight,
      visibleTasks,
    };
  }, [shouldVirtualize, tasks, virtualLayout.totalHeight, virtualSpacerOffsets, visibleTasks]);

  return {
    containerRef,
    renderModel,
    onMeasuredHeight,
  };
}
