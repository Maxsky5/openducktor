import type { DevServerGroupState } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { devServerGroupStateQueryOptions } from "@/state/queries/dev-servers";

type UseAgentStudioDevServerStateQueryArgs = {
  repoPath: string | null;
  taskId: string | null;
  queryEnabled: boolean;
  liveState: DevServerGroupState | null;
  transportGeneration: number;
};

export function useAgentStudioDevServerStateQuery({
  repoPath,
  taskId,
  queryEnabled,
  liveState,
  transportGeneration,
}: UseAgentStudioDevServerStateQueryArgs) {
  const queryOptions =
    repoPath && taskId
      ? devServerGroupStateQueryOptions(repoPath, taskId, transportGeneration)
      : devServerGroupStateQueryOptions("__disabled__", "__disabled__", transportGeneration);
  const stateQuery = useQuery({
    ...queryOptions,
    enabled: queryEnabled,
    staleTime: 0,
  });
  const { data, error, isFetching, isPending } = stateQuery;

  const queryData = queryEnabled ? (data ?? null) : null;
  const currentLiveState =
    queryEnabled && liveState?.repoPath === repoPath && liveState.taskId === taskId
      ? liveState
      : null;
  const effectiveState = currentLiveState ?? queryData;
  const isAwaitingFreshState =
    queryEnabled &&
    effectiveState == null &&
    !error &&
    (isPending || isFetching || data !== undefined);

  return {
    effectiveState,
    isAwaitingFreshState,
    queryData,
    stateQuery,
  };
}
