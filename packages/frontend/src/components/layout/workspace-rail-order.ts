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
   * Shows the drop result before the workspace store catches up, then passes the new order to
   * `commit`. Does not call `commit` when the drop cannot resolve or does not move a workspace.
   */
  commitDropOrder: (
    draggedWorkspaceId: string,
    overWorkspaceId: string,
    commit: (workspaceIds: string[]) => void,
  ) => void;
};

/**
 * Pass the workspace store list unchanged. The hook compares the list by reference.
 */
export const useWorkspaceRailOrder = (workspaces: WorkspaceRecord[]): WorkspaceRailOrder => {
  const [droppedOrder, setDroppedOrder] = useState<DroppedWorkspaceOrder | null>(null);
  // Any new store list replaces the preview.
  const orderedWorkspaces = droppedOrder?.source === workspaces ? droppedOrder.records : workspaces;
  const workspaceIds = useMemo(
    () => orderedWorkspaces.map((workspace) => workspace.workspaceId),
    [orderedWorkspaces],
  );

  const commitDropOrder = (
    draggedWorkspaceId: string,
    overWorkspaceId: string,
    commit: (workspaceIds: string[]) => void,
  ): void => {
    const draggedIndex = orderedWorkspaces.findIndex(
      (workspace) => workspace.workspaceId === draggedWorkspaceId,
    );
    const overIndex = orderedWorkspaces.findIndex(
      (workspace) => workspace.workspaceId === overWorkspaceId,
    );
    if (draggedIndex < 0 || overIndex < 0 || draggedIndex === overIndex) {
      return;
    }

    const records = arrayMove(orderedWorkspaces, draggedIndex, overIndex);
    setDroppedOrder({ source: workspaces, records });
    commit(records.map((workspace) => workspace.workspaceId));
  };

  return { workspaces: orderedWorkspaces, workspaceIds, commitDropOrder };
};
