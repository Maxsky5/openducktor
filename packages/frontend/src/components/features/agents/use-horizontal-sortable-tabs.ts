import {
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  MeasuringStrategy,
  MouseSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { useEffect, useRef, useState } from "react";

export type HorizontalTabDropPosition = "before" | "after";

export const horizontalTabDropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
};

export const horizontalTabSortTransition = {
  duration: 180,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
};

const cancelPendingAnimationFrame = (frameRef: { current: number | null }): void => {
  if (frameRef.current === null) return;
  globalThis.cancelAnimationFrame(frameRef.current);
  frameRef.current = null;
};

export const useHorizontalSortableTabs = ({
  itemIds,
  onReorder,
}: {
  itemIds: string[];
  onReorder: (draggedId: string, targetId: string, position: HorizontalTabDropPosition) => void;
}) => {
  const PrimarySensor = typeof globalThis.PointerEvent === "function" ? PointerSensor : MouseSensor;
  const sensors = useSensors(
    useSensor(PrimarySensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const suppressedSelectionIdRef = useRef<string | null>(null);
  const selectionSuppressionFrameRef = useRef<number | null>(null);

  const scheduleSelectionSuppressionClear = (): void => {
    cancelPendingAnimationFrame(selectionSuppressionFrameRef);
    selectionSuppressionFrameRef.current = globalThis.requestAnimationFrame(() => {
      suppressedSelectionIdRef.current = null;
      selectionSuppressionFrameRef.current = null;
    });
  };
  const handleDragStart = (event: DragStartEvent): void => {
    const id = String(event.active.id);
    suppressedSelectionIdRef.current = id;
    setActiveId(id);
  };
  const handleDragCancel = (): void => {
    setActiveId(null);
    scheduleSelectionSuppressionClear();
  };
  const handleDragEnd = (event: DragEndEvent): void => {
    const draggedId = String(event.active.id);
    const targetId = event.over ? String(event.over.id) : null;
    setActiveId(null);
    scheduleSelectionSuppressionClear();
    if (!targetId || draggedId === targetId) return;
    const draggedIndex = itemIds.indexOf(draggedId);
    const targetIndex = itemIds.indexOf(targetId);
    if (draggedIndex < 0 || targetIndex < 0) return;
    onReorder(draggedId, targetId, draggedIndex < targetIndex ? "after" : "before");
  };

  useEffect(() => () => cancelPendingAnimationFrame(selectionSuppressionFrameRef), []);

  return {
    activeId,
    sensors,
    collisionDetection: closestCenter,
    measuring: { droppable: { strategy: MeasuringStrategy.Always } },
    modifiers: [restrictToHorizontalAxis] as [typeof restrictToHorizontalAxis],
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    shouldSuppressSelection: (id: string): boolean => suppressedSelectionIdRef.current === id,
  };
};
