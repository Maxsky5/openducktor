import type { TaskStopImpactOperation } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceState } from "@/state/app-state-provider";
import {
  type TaskStopImpactReadPort,
  taskStopImpactQueryOptions,
} from "@/state/queries/task-stop-impact";

export type TaskStopImpactState = {
  stoppableSessionCount: number | null;
  isLoading: boolean;
};

type UseTaskStopImpactArgs = {
  taskIds: string[];
  operation: TaskStopImpactOperation;
  enabled: boolean;
  readPort?: TaskStopImpactReadPort;
};

// The count is a host-computed preview of how many live sessions the matching
// destructive mutation would stop. Null while loading or unavailable so the UI
// never promises a count the host would not deliver.
export function useTaskStopImpact({
  taskIds,
  operation,
  enabled,
  readPort,
}: UseTaskStopImpactArgs): TaskStopImpactState {
  const { activeWorkspace } = useWorkspaceState();
  const repoPath = activeWorkspace?.repoPath ?? null;
  const shouldRead = enabled && repoPath !== null && taskIds.length > 0;
  const query = useQuery({
    ...taskStopImpactQueryOptions({
      repoPath: repoPath ?? "",
      taskIds,
      operation,
      ...(readPort ? { readPort } : {}),
    }),
    enabled: shouldRead,
  });
  if (!shouldRead) {
    return { stoppableSessionCount: null, isLoading: false };
  }
  return {
    stoppableSessionCount: query.data?.stoppableSessionCount ?? null,
    isLoading: query.isPending,
  };
}
