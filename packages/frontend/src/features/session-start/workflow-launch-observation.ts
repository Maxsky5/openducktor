import { workflowLaunchSnapshotSchema, type WorkflowLaunchSnapshot } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { HostBridge } from "@/lib/shell-bridge";
import { workflowLaunchQueryOptions } from "@/state/queries/workflow-launches";
import { observeSessionLaunches } from "./session-launch-observation";

/** Read host outcomes for display without starting a launch. */
export const observeWorkflowLaunches = async ({
  workspaceId,
  repoPath,
  taskIds,
  queryClient,
  bridge,
  onSnapshot,
  onError,
}: {
  workspaceId: string;
  repoPath: string;
  taskIds: string[];
  queryClient: QueryClient;
  bridge: Pick<HostBridge, "client" | "subscribeRunEvents">;
  onSnapshot: (snapshot: WorkflowLaunchSnapshot) => void;
  onError: (cause: unknown) => void;
}): Promise<() => void> => {
  return observeSessionLaunches({
    workspaceId,
    repoPath,
    ownerIds: taskIds,
    bridge,
    onSnapshot,
    onError,
    owner: (snapshot) => snapshot.taskId,
    eventType: "workflow_launch_updated",
    schema: workflowLaunchSnapshotSchema,
    readOwner: async (taskId, refresh) => {
      const query = workflowLaunchQueryOptions({ workspaceId, repoPath, taskId }, bridge.client);
      if (refresh) await queryClient.cancelQueries({ queryKey: query.queryKey, exact: true });
      return queryClient.fetchQuery(query);
    },
  });
};
