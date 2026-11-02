import { arrayMove } from "@dnd-kit/sortable";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { useMemo, useState } from "react";

type DroppedWorkspaceOrder = {
  source: WorkspaceRecord[];
  records: WorkspaceRecord[];
};

type WorkspaceRailOrder = {
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
  // A new workspace list is authoritative: the store has caught up with the drop.
  const orderedWorkspaces = droppedOrder?.source === workspaces ? droppedOrder.records : workspaces;
  const workspaceIds = useMemo(
    () => orderedWorkspaces.map((workspace) => workspace.workspaceId),
    [orderedWorkspaces],
  );

  const showDropOrder = (draggedWorkspaceId: string, overWorkspaceId: string): string[] | null => {
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
  };

  return { workspaces: orderedWorkspaces, workspaceIds, showDropOrder };
};
