import { arrayMove } from "@dnd-kit/sortable";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";

type DroppedWorkspaceOrder = {
  source: WorkspaceRecord[];
  records: WorkspaceRecord[];
};

export type WorkspaceRailOrder = {
  workspaces: WorkspaceRecord[];
  workspaceIds: string[];
  /**
   * Shows the drop result before the workspace store catches up, so the drag end and the new
   * order render in the same frame. Returns the new order, or null when the drop changes nothing.
   */
  showDropOrder: (draggedWorkspaceId: string, overWorkspaceId: string) => string[] | null;
};

export const useWorkspaceRailOrder = (workspaces: WorkspaceRecord[]): WorkspaceRailOrder => {
  const [droppedOrder, setDroppedOrder] = useState<DroppedWorkspaceOrder | null>(null);
  const appliedDroppedOrder = droppedOrder?.source === workspaces ? droppedOrder : null;

  if (droppedOrder !== null && appliedDroppedOrder === null) {
    // A new workspace list is authoritative. Drop the preview order during this render.
    setDroppedOrder(null);
  }

  const orderedWorkspaces = appliedDroppedOrder?.records ?? workspaces;
  const workspaceIds = useMemo(
    () => orderedWorkspaces.map((workspace) => workspace.workspaceId),
    [orderedWorkspaces],
  );

  const showDropOrder = useCallback(
    (draggedWorkspaceId: string, overWorkspaceId: string): string[] | null => {
      const draggedIndex = orderedWorkspaces.findIndex(
        (workspace) => workspace.workspaceId === draggedWorkspaceId,
      );
      const overIndex = orderedWorkspaces.findIndex(
        (workspace) => workspace.workspaceId === overWorkspaceId,
      );
      if (draggedIndex < 0 || overIndex < 0 || draggedIndex === overIndex) {
        return null;
      }

      const records = arrayMove(orderedWorkspaces, draggedIndex, overIndex);
      setDroppedOrder({ source: workspaces, records });
      return records.map((workspace) => workspace.workspaceId);
    },
    [orderedWorkspaces, workspaces],
  );

  return { workspaces: orderedWorkspaces, workspaceIds, showDropOrder };
};
