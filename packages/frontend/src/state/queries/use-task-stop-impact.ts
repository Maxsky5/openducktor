import type { TaskStopImpactOperation } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";
import {
  type TaskStopImpactReadPort,
  taskStopImpactQueryOptions,
} from "@/state/queries/task-stop-impact";

export type TaskStopImpactState = {
  stoppableSessionCount: number | null;
  isLoading: boolean;
  error: string | null;
};

type UseTaskStopImpactArgs = {
  taskIds: string[];
  operation: TaskStopImpactOperation;
  enabled: boolean;
  readPort?: TaskStopImpactReadPort;
};

// The count is a host-computed preview of how many live sessions the matching
// destructive mutation would stop. It stays null until the authoritative read
// succeeds so the UI never promises a count the host would not deliver.
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
    return { stoppableSessionCount: null, isLoading: false, error: null };
  }
  if (query.isError) {
    return {
      stoppableSessionCount: null,
      isLoading: false,
      error: errorMessage(query.error),
    };
  }
  return {
    stoppableSessionCount: query.data?.stoppableSessionCount ?? null,
    // A mounted observer keeps the cache entry alive, so a dialog reopen can
    // hit cached data while a background refetch runs. Gate Confirm on both.
    isLoading: query.isPending || query.isFetching,
    error: null,
  };
}
