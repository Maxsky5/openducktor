import type { TaskStopImpactOperation } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";
import { taskStopImpactQueryOptions } from "@openducktor/frontend-core/queries/task-stop-impact";

export type TaskStopImpactState = {
  stoppableSessionCount: number | null;
  isLoading: boolean;
  error: string | null;
};

type UseTaskStopImpactArgs = {
  taskIds: string[];
  operation: TaskStopImpactOperation;
  enabled: boolean;
};

export function useTaskStopImpact({
  taskIds,
  operation,
  enabled,
}: UseTaskStopImpactArgs): TaskStopImpactState {
  const { activeWorkspace } = useWorkspaceState();
  const repoPath = activeWorkspace?.repoPath ?? null;
  const shouldRead = enabled && repoPath !== null && taskIds.length > 0;
  const query = useQuery({
    ...taskStopImpactQueryOptions({ repoPath: repoPath ?? "", taskIds, operation }),
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
