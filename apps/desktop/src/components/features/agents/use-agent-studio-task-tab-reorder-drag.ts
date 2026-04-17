import { type DragEvent as ReactDragEvent, useEffect, useRef, useState } from "react";

type DropPosition = "before" | "after";

type DropTarget = {
  taskId: string;
  position: DropPosition;
};

type UseAgentStudioTaskTabReorderDragArgs = {
  onReorderTab: (draggedTaskId: string, targetTaskId: string, position: DropPosition) => void;
};

type TabDragHandlers = {
  draggable: true;
  onDragStart: (event: ReactDragEvent<HTMLElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDrop: (event: ReactDragEvent<HTMLElement>) => void;
};

const AUTO_SCROLL_EDGE_THRESHOLD = 48;
const AUTO_SCROLL_MAX_STEP = 18;

const getDragDropPosition = (event: ReactDragEvent<HTMLElement>): DropPosition => {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientX <= bounds.left + bounds.width / 2 ? "before" : "after";
};

export function useAgentStudioTaskTabReorderDrag({
  onReorderTab,
}: UseAgentStudioTaskTabReorderDragArgs): {
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  draggedTaskId: string | null;
  dropTarget: DropTarget | null;
  handleStripDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  handleStripDrop: () => void;
  getTabDragHandlers: (taskId: string) => TabDragHandlers;
} {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollStepRef = useRef(0);

  const stopAutoScroll = (): void => {
    if (autoScrollFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    autoScrollStepRef.current = 0;
  };

  const clearDragState = (): void => {
    setDraggedTaskId(null);
    setDropTarget(null);
    stopAutoScroll();
  };

  const updateAutoScroll = (clientX: number): void => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) {
      stopAutoScroll();
      return;
    }

    const bounds = scrollRegion.getBoundingClientRect();
    let nextStep = 0;

    if (clientX < bounds.left + AUTO_SCROLL_EDGE_THRESHOLD) {
      const distanceToEdge = bounds.left + AUTO_SCROLL_EDGE_THRESHOLD - clientX;
      nextStep = -Math.min(
        AUTO_SCROLL_MAX_STEP,
        Math.max(4, (distanceToEdge / AUTO_SCROLL_EDGE_THRESHOLD) * AUTO_SCROLL_MAX_STEP),
      );
    } else if (clientX > bounds.right - AUTO_SCROLL_EDGE_THRESHOLD) {
      const distanceToEdge = clientX - (bounds.right - AUTO_SCROLL_EDGE_THRESHOLD);
      nextStep = Math.min(
        AUTO_SCROLL_MAX_STEP,
        Math.max(4, (distanceToEdge / AUTO_SCROLL_EDGE_THRESHOLD) * AUTO_SCROLL_MAX_STEP),
      );
    }

    autoScrollStepRef.current = nextStep;

    if (nextStep === 0) {
      stopAutoScroll();
      return;
    }

    if (autoScrollFrameRef.current !== null) {
      return;
    }

    const step = (): void => {
      const nextScrollRegion = scrollRegionRef.current;
      if (!nextScrollRegion || autoScrollStepRef.current === 0) {
        autoScrollFrameRef.current = null;
        return;
      }

      nextScrollRegion.scrollLeft += autoScrollStepRef.current;
      autoScrollFrameRef.current = globalThis.requestAnimationFrame(step);
    };

    autoScrollFrameRef.current = globalThis.requestAnimationFrame(step);
  };

  useEffect(() => {
    return () => {
      if (autoScrollFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(autoScrollFrameRef.current);
      }
    };
  }, []);

  const handleStripDragOver = (event: ReactDragEvent<HTMLElement>): void => {
    if (!draggedTaskId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    updateAutoScroll(event.clientX);
  };

  const handleStripDrop = (): void => {
    clearDragState();
  };

  const getTabDragHandlers = (taskId: string): TabDragHandlers => ({
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", taskId);
      setDraggedTaskId(taskId);
      setDropTarget(null);
    },
    onDragOver: (event) => {
      if (!draggedTaskId) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      updateAutoScroll(event.clientX);

      if (draggedTaskId === taskId) {
        setDropTarget(null);
        return;
      }

      const position = getDragDropPosition(event);
      setDropTarget((current) => {
        if (current?.taskId === taskId && current.position === position) {
          return current;
        }
        return { taskId, position };
      });
    },
    onDragEnd: clearDragState,
    onDrop: (event) => {
      if (!draggedTaskId) {
        clearDragState();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (draggedTaskId === taskId) {
        clearDragState();
        return;
      }

      onReorderTab(draggedTaskId, taskId, getDragDropPosition(event));
      clearDragState();
    },
  });

  return {
    scrollRegionRef,
    draggedTaskId,
    dropTarget,
    handleStripDragOver,
    handleStripDrop,
    getTabDragHandlers,
  };
}
