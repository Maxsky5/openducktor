import type { DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { devServerGroupStateQueryOptions } from "@/state/queries/dev-servers";
import { isSameDevServerOwner } from "@/types/dev-server-scope";

type UseAgentStudioDevServerStateQueryArgs = {
  repoPath: string | null;
  owner: DevServerOwner | null;
  queryEnabled: boolean;
  liveState: DevServerGroupState | null;
  transportEpoch: string | null;
};

const selectEffectiveState = (
  queryData: DevServerGroupState | null,
  liveState: DevServerGroupState | null,
  repoPath: string | null,
  owner: DevServerOwner | null,
): DevServerGroupState | null => {
  const scopedLiveState =
    liveState?.repoPath === repoPath && owner && isSameDevServerOwner(liveState.owner, owner)
      ? liveState
      : null;
  return scopedLiveState && queryData && queryData.revision > scopedLiveState.revision
    ? queryData
    : (scopedLiveState ?? queryData);
};

export function useAgentStudioDevServerStateQuery({
  repoPath,
  owner,
  queryEnabled,
  liveState,
  transportEpoch,
}: UseAgentStudioDevServerStateQueryArgs) {
  const queryOptions =
    repoPath && owner && transportEpoch
      ? devServerGroupStateQueryOptions(repoPath, owner, transportEpoch)
      : devServerGroupStateQueryOptions(
          "__disabled__",
          { kind: "task", taskId: "__disabled__" },
          "disabled",
        );
  const stateQuery = useQuery({
    ...queryOptions,
    enabled: queryEnabled,
    staleTime: 0,
  });
  const { data, error, isFetching, isPending } = stateQuery;

  const queryData = queryEnabled ? (data ?? null) : null;
  const effectiveState = selectEffectiveState(
    queryData,
    queryEnabled ? liveState : null,
    repoPath,
    owner,
  );
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
