import { useHorizontalSortableTabs } from "@/components/ui/use-horizontal-sortable-tabs";

type UseAgentStudioTaskTabReorderDragArgs = {
  tabTaskIds: string[];
  onReorderTab: (draggedTaskId: string, targetTaskId: string, position: "before" | "after") => void;
};

export function useAgentStudioTaskTabReorderDrag({
  tabTaskIds,
  onReorderTab,
}: UseAgentStudioTaskTabReorderDragArgs) {
  const drag = useHorizontalSortableTabs({ itemIds: tabTaskIds, onReorder: onReorderTab });
  return { ...drag, activeTaskId: drag.activeId };
}
