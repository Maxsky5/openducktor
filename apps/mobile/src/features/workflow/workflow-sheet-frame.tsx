import type { WorkspaceRecord } from "@openducktor/contracts";
import { useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import {
  OtherWorkspaceState,
  SelectedWorkspaceGate,
} from "@/features/workspaces/no-open-workspace";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import { EmptyState } from "@/ui/states";
import { routeParam } from "@/navigation/route-params";

/** The route params of a workflow sheet. */
export type WorkflowSheetParams = {
  workspaceId: string | null;
  taskId: string | null;
  action: string | null;
  /** The session launch action of a quick action, which the start sheet runs instead. */
  launch: string | null;
};

export const useWorkflowSheetParams = (): WorkflowSheetParams => {
  const params = useLocalSearchParams<{
    workspaceId: string;
    taskId: string;
    action: string;
    launch: string;
  }>();
  return {
    workspaceId: routeParam(params.workspaceId),
    taskId: routeParam(params.taskId),
    action: routeParam(params.action),
    launch: routeParam(params.launch),
  };
};

/**
 * A workflow sheet runs in the workspace that Tasks shows, because the task workflow commands of
 * frontend-core use that workspace. The content draws its own `GroupedSheet` steps; this frame
 * draws the sheet while the workspace loads, fails, or does not match, and for a link without a
 * workspace or task.
 */
export function WorkflowSheetFrame({
  title,
  workspaceId,
  taskId,
  children,
}: {
  /** The sheet title while the workspace is not ready. */
  title: string;
  workspaceId: string | null;
  taskId: string | null;
  children: (workspace: WorkspaceRecord, taskId: string) => ReactNode;
}): ReactNode {
  const { selectedWorkspace } = useMobileWorkspaces();
  if (!workspaceId || !taskId) {
    return (
      <GroupedSheet title={title}>
        <EmptyState
          icon="link-off"
          title="Incomplete Link"
          message="It does not name a task. Open the action again from its task."
        />
      </GroupedSheet>
    );
  }
  if (selectedWorkspace?.workspaceId === workspaceId) {
    return children(selectedWorkspace, taskId);
  }
  return (
    <GroupedSheet title={title}>
      <SelectedWorkspaceGate>{() => <OtherWorkspaceState />}</SelectedWorkspaceGate>
    </GroupedSheet>
  );
}
