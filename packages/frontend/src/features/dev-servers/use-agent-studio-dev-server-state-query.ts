import type { DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { devServerGroupStateQueryOptions, devServerQueryKeys } from "@/state/queries/dev-servers";
import { isSameDevServerOwner } from "@/types/dev-server-scope";

type UseAgentStudioDevServerStateQueryArgs = {
  repoPath: string | null;
  owner: DevServerOwner | null;
  enabled: boolean;
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
  enabled,
  queryEnabled,
  liveState,
  transportEpoch,
}: UseAgentStudioDevServerStateQueryArgs) {
  const queryClient = useQueryClient();
  const stateQuery = useQuery({
    ...stateQueryOptions(repoPath, owner, transportEpoch),
    enabled: queryEnabled,
    staleTime: 0,
  });
  const { data, error, isFetching, isPending } = stateQuery;

  const queryData = queryEnabled ? (data ?? null) : null;
  const currentState = selectEffectiveState(
    queryData,
    queryEnabled ? liveState : null,
    repoPath,
    owner,
  );
  const cachedState = latestCachedState(queryClient, repoPath, owner, enabled);
  const effectiveState = currentState ?? (error ? null : cachedState);
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

const stateQueryOptions = (
  repoPath: string | null,
  owner: DevServerOwner | null,
  transportEpoch: string | null,
) =>
  repoPath && owner && transportEpoch
    ? devServerGroupStateQueryOptions(repoPath, owner, transportEpoch)
    : devServerGroupStateQueryOptions(
        "__disabled__",
        { kind: "task", taskId: "__disabled__" },
        "disabled",
      );

const latestCachedState = (
  queryClient: QueryClient,
  repoPath: string | null,
  owner: DevServerOwner | null,
  enabled: boolean,
): DevServerGroupState | null => {
  if (!enabled || !repoPath || !owner) return null;
  let newest: DevServerGroupState | null = null;
  let updatedAt = 0;
  for (const query of queryClient.getQueryCache().findAll({
    queryKey: devServerQueryKeys.owner(repoPath, owner),
  })) {
    const state = queryClient.getQueryData<DevServerGroupState>(query.queryKey);
    if (
      !state ||
      state.repoPath !== repoPath ||
      !isSameDevServerOwner(state.owner, owner) ||
      query.state.dataUpdatedAt < updatedAt
    ) {
      continue;
    }
    newest = state;
    updatedAt = query.state.dataUpdatedAt;
  }
  return newest;
};
