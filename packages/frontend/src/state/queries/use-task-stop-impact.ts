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

export function useTaskStopImpact({
  taskIds,
  operation,
  enabled,
  readPort,
}: UseTaskStopImpactArgs): TaskStopImpactState {
  const { activeWorkspace } = useWorkspaceState();
  const repoPath = activeWorkspace?.repoPath ?? null;
  const shouldRead = enabled && repoPath !== null && taskIds.length > 0;
  const queryArgs: Parameters<typeof taskStopImpactQueryOptions>[0] = {
    repoPath: repoPath ?? "",
    taskIds,
    operation,
  };
  if (readPort) {
    queryArgs.readPort = readPort;
  }
  const query = useQuery({
    ...taskStopImpactQueryOptions(queryArgs),
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
    // Cached data can stay on screen during a new read. Block Confirm until it ends.
    isLoading: query.isPending || query.isFetching,
    error: null,
  };
}
