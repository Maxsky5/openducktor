import { workflowReferenceSchema } from "@openducktor/contracts";
import { z } from "zod";
import type { TaskWorkflowContinuation } from "@openducktor/frontend-core/tasks/workflow/task-workflow-continuation";
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
  /** What the human feedback sheet does: `launch` or `request_changes`. */
  mode: string | null;
  /** The session launch action of a quick action, which the start sheet runs instead. */
  launch: string | null;
  continuation: TaskWorkflowContinuation | undefined;
};

export const useWorkflowSheetParams = (): WorkflowSheetParams => {
  const params = useLocalSearchParams<{
    workspaceId: string;
    taskId: string;
    action: string;
    mode: string;
    launch: string;
    continuation: string;
  }>();
  return {
    workspaceId: routeParam(params.workspaceId),
    taskId: routeParam(params.taskId),
    action: routeParam(params.action),
    mode: routeParam(params.mode),
    launch: routeParam(params.launch),
    continuation: parseWorkflowContinuation(routeParam(params.continuation)),
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
          title="Incomplete task link"
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

const parseWorkflowContinuation = (raw: string | null): TaskWorkflowContinuation | undefined => {
  if (!raw) return undefined;
  return z
    .object({ workflow: workflowReferenceSchema, launchActionIds: z.array(z.string()) })
    .parse(JSON.parse(raw));
};
