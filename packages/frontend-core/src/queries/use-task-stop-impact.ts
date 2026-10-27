import type { TaskStopImpactOperation } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useActiveWorkspaceContext } from "../app-state/app-state-contexts";
import { errorMessage } from "../lib/errors";
import { taskStopImpactQueryOptions } from "./task-stop-impact";

export type TaskStopImpactState = {
  stoppableSessionCount: number | null;
  /** The existing task worktrees that the action removes, or null when the host omits it. */
  removedWorktreeCount: number | null;
  isLoading: boolean;
  error: string | null;
  /** Reads the session count again, for example after a failed read. */
  retry: () => void;
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
  const { activeWorkspace } = useActiveWorkspaceContext();
  const repoPath = activeWorkspace?.repoPath ?? null;
  const shouldRead = enabled && repoPath !== null && taskIds.length > 0;
  const query = useQuery({
    ...taskStopImpactQueryOptions({ repoPath: repoPath ?? "", taskIds, operation }),
    enabled: shouldRead,
  });
  const retry = () => {
    void query.refetch();
  };
  if (!shouldRead) {
    // A closing confirmation keeps its last count, so its exit shows no change.
    return {
      stoppableSessionCount: query.data?.stoppableSessionCount ?? null,
      removedWorktreeCount: query.data?.removedWorktreeCount ?? null,
      isLoading: false,
      error: null,
      retry,
    };
  }
  if (query.isError) {
    return {
      stoppableSessionCount: null,
      removedWorktreeCount: null,
      // A retry of a failed read runs while the error stays.
      isLoading: query.isFetching,
      error: errorMessage(query.error),
      retry,
    };
  }
  return {
    stoppableSessionCount: query.data?.stoppableSessionCount ?? null,
    removedWorktreeCount: query.data?.removedWorktreeCount ?? null,
    // Cached data can stay on screen during a new read. Block Confirm until it ends.
    isLoading: query.isPending || query.isFetching,
    error: null,
    retry,
  };
}
