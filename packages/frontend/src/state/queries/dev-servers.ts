import type { DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "@/state/operations/shared/host";

const DEV_SERVER_STATE_STALE_TIME_MS = 5_000;

export const devServerQueryKeys = {
  all: ["dev-servers"] as const,
  repo: (repoPath: string) => [...devServerQueryKeys.all, "state", repoPath] as const,
  state: (repoPath: string, owner: DevServerOwner, transportEpoch: string) =>
    [...devServerQueryKeys.repo(repoPath), owner, transportEpoch] as const,
};

export const devServerGroupStateQueryOptions = (
  repoPath: string,
  owner: DevServerOwner,
  transportEpoch: string,
) =>
  queryOptions({
    queryKey: devServerQueryKeys.state(repoPath, owner, transportEpoch),
    queryFn: (): Promise<DevServerGroupState> => host.devServerGetState(repoPath, owner),
    staleTime: DEV_SERVER_STATE_STALE_TIME_MS,
  });
