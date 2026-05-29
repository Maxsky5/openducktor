import type { DevServerGroupState } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { devServerGroupStateQueryOptions } from "@/state/queries/dev-servers";

type UseAgentStudioDevServerStateQueryArgs = {
  repoPath: string | null;
  taskId: string | null;
  queryEnabled: boolean;
  liveState: DevServerGroupState | null;
};

export function useAgentStudioDevServerStateQuery({
  repoPath,
  taskId,
  queryEnabled,
  liveState,
}: UseAgentStudioDevServerStateQueryArgs) {
  const [activationState, setActivationState] = useState<{
    enabled: boolean;
    since: number;
  }>(() => ({
    enabled: queryEnabled,
    since: queryEnabled ? Date.now() : 0,
  }));
  const queryOptions =
    repoPath && taskId
      ? devServerGroupStateQueryOptions(repoPath, taskId)
      : devServerGroupStateQueryOptions("__disabled__", "__disabled__");
  const stateQuery = useQuery({
    ...queryOptions,
    enabled: queryEnabled,
  });
  const { data, dataUpdatedAt, error, isFetching, isPending, refetch } = stateQuery;

  useEffect(() => {
    setActivationState((current) => {
      if (current.enabled === queryEnabled) {
        return current;
      }

      return {
        enabled: queryEnabled,
        since: queryEnabled ? Date.now() : 0,
      };
    });
  }, [queryEnabled]);

  useEffect(() => {
    if (!queryEnabled || repoPath === null || taskId === null) {
      return;
    }

    if (isFetching || dataUpdatedAt >= activationState.since) {
      return;
    }

    void refetch();
  }, [activationState.since, dataUpdatedAt, isFetching, queryEnabled, refetch, repoPath, taskId]);

  const queryData =
    queryEnabled && activationState.enabled === queryEnabled ? (data ?? null) : null;
  const currentLiveState = queryEnabled ? liveState : null;
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
