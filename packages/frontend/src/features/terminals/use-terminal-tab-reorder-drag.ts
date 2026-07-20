import { useHorizontalSortableTabs } from "@/components/ui/use-horizontal-sortable-tabs";

export const useTerminalTabReorderDrag = ({
  tabIds,
  onReorderTab,
}: {
  tabIds: string[];
  onReorderTab: (draggedTabId: string, targetTabId: string, position: "before" | "after") => void;
}) => {
  const drag = useHorizontalSortableTabs({ itemIds: tabIds, onReorder: onReorderTab });
  return { ...drag, activeTabId: drag.activeId };
};
