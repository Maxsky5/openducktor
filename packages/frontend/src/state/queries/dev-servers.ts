import type { DevServerGroupState, DevServerOwner } from "@openducktor/contracts";
import { queryOptions, replaceEqualDeep } from "@tanstack/react-query";
import { host } from "@/state/operations/shared/host";

const DEV_SERVER_STATE_STALE_TIME_MS = 5_000;

export const devServerQueryKeys = {
  all: ["dev-servers"] as const,
  repo: (repoPath: string) => [...devServerQueryKeys.all, "state", repoPath] as const,
  owner: (repoPath: string, owner: DevServerOwner) =>
    [...devServerQueryKeys.repo(repoPath), owner] as const,
  state: (repoPath: string, owner: DevServerOwner, transportEpoch: string) =>
    [...devServerQueryKeys.owner(repoPath, owner), transportEpoch] as const,
};

export const devServerGroupStateQueryOptions = (
  repoPath: string,
  owner: DevServerOwner,
  transportEpoch: string,
) =>
  queryOptions({
    queryKey: devServerQueryKeys.state(repoPath, owner, transportEpoch),
    queryFn: (): Promise<DevServerGroupState> => host.devServerGetState(repoPath, owner),
    structuralSharing: (previous, next) => {
      // SAFETY: This query key holds DevServerGroupState metadata validated by the host client.
      const current = previous as DevServerGroupState | undefined;
      // SAFETY: Query, event, and mutation writers supply the same validated metadata contract.
      const candidate = next as DevServerGroupState;
      return current && current.revision > candidate.revision
        ? current
        : replaceEqualDeep(current, candidate);
    },
    staleTime: DEV_SERVER_STATE_STALE_TIME_MS,
  });
