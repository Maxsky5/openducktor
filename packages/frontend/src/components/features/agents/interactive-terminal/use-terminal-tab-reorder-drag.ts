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
import { useState } from "react";

type DropPosition = "before" | "after";

export const useTerminalTabReorderDrag = ({
  tabIds,
  onReorderTab,
}: {
  tabIds: string[];
  onReorderTab: (draggedTabId: string, targetTabId: string, position: DropPosition) => void;
}) => {
  const PrimarySensor = typeof globalThis.PointerEvent === "function" ? PointerSensor : MouseSensor;
  const sensors = useSensors(
    useSensor(PrimarySensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent): void => {
    setActiveTabId(String(event.active.id));
  };
  const handleDragCancel = (): void => setActiveTabId(null);
  const handleDragEnd = (event: DragEndEvent): void => {
    const draggedTabId = String(event.active.id);
    const targetTabId = event.over ? String(event.over.id) : null;
    setActiveTabId(null);
    if (!targetTabId || draggedTabId === targetTabId) return;
    const draggedIndex = tabIds.indexOf(draggedTabId);
    const targetIndex = tabIds.indexOf(targetTabId);
    if (draggedIndex < 0 || targetIndex < 0) return;
    onReorderTab(draggedTabId, targetTabId, draggedIndex < targetIndex ? "after" : "before");
  };

  return {
    activeTabId,
    sensors,
    collisionDetection: closestCenter,
    measuring: { droppable: { strategy: MeasuringStrategy.Always } },
    modifiers: [restrictToHorizontalAxis],
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
};
