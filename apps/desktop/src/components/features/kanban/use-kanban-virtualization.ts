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

type KanbanViewportSubscriber = {
  element: HTMLDivElement;
  onSync: () => void;
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
  containerRef: (node: HTMLDivElement | null) => void;
  renderModel: KanbanVirtualizationRenderModel;
  measurementVersion: number;
  onMeasuredHeight: (taskId: string, height: number) => void;
};

type VirtualLayoutSnapshot = {
  itemOffsets: number[];
  itemHeights: number[];
  totalHeight: number;
};

const viewportSubscribers = new Map<number, KanbanViewportSubscriber>();
const viewportScrollContainers = new Map<HTMLElement, number>();
let viewportSubscriptionId = 0;
let viewportSyncFrameHandle: number | null = null;
let hasViewportWindowListeners = false;

const scheduleViewportSubscribersSync = (): void => {
  if (typeof window === "undefined" || viewportSyncFrameHandle !== null) {
    return;
  }

  viewportSyncFrameHandle = window.requestAnimationFrame(() => {
    viewportSyncFrameHandle = null;
    for (const subscriber of viewportSubscribers.values()) {
      subscriber.onSync();
    }
  });
};

const onViewportWindowEvent = (): void => {
  scheduleViewportSubscribersSync();
};

const retainViewportWindowListeners = (): void => {
  if (typeof window === "undefined" || hasViewportWindowListeners) {
    return;
  }

  window.addEventListener("scroll", onViewportWindowEvent, { passive: true });
  window.addEventListener("resize", onViewportWindowEvent);
  hasViewportWindowListeners = true;
};

const releaseViewportWindowListeners = (): void => {
  if (
    typeof window === "undefined" ||
    !hasViewportWindowListeners ||
    viewportSubscribers.size > 0 ||
    viewportScrollContainers.size > 0
  ) {
    return;
  }

  window.removeEventListener("scroll", onViewportWindowEvent);
  window.removeEventListener("resize", onViewportWindowEvent);
  if (viewportSyncFrameHandle !== null) {
    window.cancelAnimationFrame(viewportSyncFrameHandle);
    viewportSyncFrameHandle = null;
  }
  hasViewportWindowListeners = false;
};

const retainViewportScrollContainer = (container: HTMLElement): void => {
  const nextCount = (viewportScrollContainers.get(container) ?? 0) + 1;
  viewportScrollContainers.set(container, nextCount);
  if (nextCount === 1) {
    container.addEventListener("scroll", onViewportWindowEvent, { passive: true });
  }
};

const releaseViewportScrollContainer = (container: HTMLElement): void => {
  const currentCount = viewportScrollContainers.get(container);
  if (!currentCount) {
    return;
  }

  if (currentCount === 1) {
    viewportScrollContainers.delete(container);
    container.removeEventListener("scroll", onViewportWindowEvent);
    releaseViewportWindowListeners();
    return;
  }

  viewportScrollContainers.set(container, currentCount - 1);
};

const registerViewportSubscriber = (subscriber: KanbanViewportSubscriber): (() => void) => {
  retainViewportWindowListeners();

  const scrollContainer = subscriber.element.closest(
    "[data-main-scroll-container='true']",
  ) as HTMLElement | null;
  if (scrollContainer) {
    retainViewportScrollContainer(scrollContainer);
  }

  const subscriberId = viewportSubscriptionId;
  viewportSubscriptionId += 1;
  viewportSubscribers.set(subscriberId, subscriber);
  scheduleViewportSubscribersSync();

  return () => {
    viewportSubscribers.delete(subscriberId);
    if (scrollContainer) {
      releaseViewportScrollContainer(scrollContainer);
    }
    releaseViewportWindowListeners();
  };
};

export function useKanbanVirtualization({
  tasks,
}: UseKanbanVirtualizationArgs): UseKanbanVirtualizationResult {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [measuredHeightsByTaskId, setMeasuredHeightsByTaskId] = useState<Record<string, number>>(
    {},
  );
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const shouldVirtualize = tasks.length >= VIRTUALIZATION_MIN_TASK_COUNT;
  const containerRef = useCallback((node: HTMLDivElement | null): void => {
    setContainerElement(node);
  }, []);

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

      const viewportElement = containerElement;
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
  }, [containerElement, shouldVirtualize]);

  useEffect(() => {
    if (!shouldVirtualize || typeof window === "undefined" || !containerElement) {
      return;
    }

    return registerViewportSubscriber({
      element: containerElement,
      onSync: () => {
        syncViewportRef.current();
      },
    });
  }, [containerElement, shouldVirtualize]);

  useEffect(() => {
    if (!shouldVirtualize || !containerElement || typeof ResizeObserver === "undefined") {
      return;
    }

    let frameHandle: number | null = null;
    const scheduleMeasurementInvalidation = (): void => {
      if (typeof window === "undefined") {
        setMeasurementVersion((current) => current + 1);
        return;
      }

      if (frameHandle !== null) {
        return;
      }

      frameHandle = window.requestAnimationFrame(() => {
        frameHandle = null;
        setMeasurementVersion((current) => current + 1);
        syncViewportRef.current();
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleMeasurementInvalidation();
    });

    observer.observe(containerElement);
    return () => {
      observer.disconnect();
      if (frameHandle !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(frameHandle);
      }
    };
  }, [containerElement, shouldVirtualize]);

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
    measurementVersion,
    onMeasuredHeight,
  };
}
