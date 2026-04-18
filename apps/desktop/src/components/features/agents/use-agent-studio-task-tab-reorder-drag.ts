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

type UseAgentStudioTaskTabReorderDragArgs = {
  tabTaskIds: string[];
  onReorderTab: (draggedTaskId: string, targetTaskId: string, position: DropPosition) => void;
};

export function useAgentStudioTaskTabReorderDrag({
  tabTaskIds,
  onReorderTab,
}: UseAgentStudioTaskTabReorderDragArgs): {
  activeTaskId: string | null;
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: typeof closestCenter;
  measuring: {
    droppable: {
      strategy: MeasuringStrategy;
    };
  };
  modifiers: [typeof restrictToHorizontalAxis];
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: () => void;
} {
  const PrimarySensor = typeof globalThis.PointerEvent === "function" ? PointerSensor : MouseSensor;

  const sensors = useSensors(
    useSensor(PrimarySensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent): void => {
    setActiveTaskId(String(event.active.id));
  };

  const handleDragCancel = (): void => {
    setActiveTaskId(null);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    const draggedTaskId = String(event.active.id);
    const overTaskId = event.over ? String(event.over.id) : null;
    setActiveTaskId(null);

    if (!overTaskId || draggedTaskId === overTaskId) {
      return;
    }

    const draggedIndex = tabTaskIds.indexOf(draggedTaskId);
    const overIndex = tabTaskIds.indexOf(overTaskId);

    if (draggedIndex < 0 || overIndex < 0) {
      return;
    }

    onReorderTab(draggedTaskId, overTaskId, draggedIndex < overIndex ? "after" : "before");
  };

  return {
    activeTaskId,
    sensors,
    collisionDetection: closestCenter,
    measuring: {
      droppable: {
        strategy: MeasuringStrategy.Always,
      },
    },
    modifiers: [restrictToHorizontalAxis],
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}
