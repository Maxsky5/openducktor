import { useEffect, useEffectEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hostBridge } from "@/lib/host-client";
import { errorMessage } from "@/lib/errors";
import { useTaskSnapshotContext, useActiveWorkspaceContext } from "@/state/app-state-contexts";
import { observeWorkflowLaunches } from "./workflow-launch-observation";
import { presentWorkflowLaunchOutcome } from "./session-start-message-recovery";
import type { WorkflowLaunchSnapshot } from "@openducktor/contracts";

/** Restore host launch failures even when no chat is open. */
export function useWorkflowLaunchRecovery(): void {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const { tasks, isLoadingTasks } = useTaskSnapshotContext();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const repoPath = activeWorkspace?.repoPath ?? null;
  const taskIdsKey = JSON.stringify(tasks.map((task) => task.id).sort());
  const present = useEffectEvent((snapshot: WorkflowLaunchSnapshot) => {
    presentWorkflowLaunchOutcome(snapshot, hostBridge.client);
  });
  useEffect(() => {
    if (!workspaceId || !repoPath || isLoadingTasks) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const onError = (cause: unknown) => {
      if (!disposed)
        toast.error("Cannot observe workflow launches.", { description: errorMessage(cause) });
    };
    void observeWorkflowLaunches({
      workspaceId,
      repoPath,
      // SAFETY: taskIdsKey contains only the string IDs encoded above.
      taskIds: JSON.parse(taskIdsKey) as string[],
      queryClient,
      bridge: hostBridge,
      onSnapshot: (snapshot) => {
        if (!disposed) present(snapshot);
      },
      onError,
    })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch(onError);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [workspaceId, repoPath, taskIdsKey, isLoadingTasks, queryClient]);
}
