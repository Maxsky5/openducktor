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

    if (stateQuery.isFetching || stateQuery.dataUpdatedAt >= activationState.since) {
      return;
    }

    void stateQuery.refetch();
  }, [
    activationState.since,
    queryEnabled,
    repoPath,
    stateQuery,
    stateQuery.dataUpdatedAt,
    stateQuery.isFetching,
    taskId,
  ]);

  const queryData =
    queryEnabled && activationState.enabled === queryEnabled ? (stateQuery.data ?? null) : null;
  const currentLiveState = queryEnabled ? liveState : null;
  const effectiveState = currentLiveState ?? queryData;
  const isAwaitingFreshState =
    queryEnabled &&
    effectiveState == null &&
    !stateQuery.error &&
    (stateQuery.isPending || stateQuery.isFetching || stateQuery.data !== undefined);

  return {
    effectiveState,
    isAwaitingFreshState,
    queryData,
    stateQuery,
  };
}
