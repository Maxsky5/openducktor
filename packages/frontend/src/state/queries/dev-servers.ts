import type { DevServerGroupState } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "@/state/operations/shared/host";

const DEV_SERVER_STATE_STALE_TIME_MS = 5_000;

export const devServerQueryKeys = {
  all: ["dev-servers"] as const,
  state: (repoPath: string, taskId: string, transportGeneration = 0) =>
    [...devServerQueryKeys.all, "state", repoPath, taskId, transportGeneration] as const,
};

export const devServerGroupStateQueryOptions = (
  repoPath: string,
  taskId: string,
  transportGeneration = 0,
) =>
  queryOptions({
    queryKey: devServerQueryKeys.state(repoPath, taskId, transportGeneration),
    queryFn: (): Promise<DevServerGroupState> => host.devServerGetState(repoPath, taskId),
    staleTime: DEV_SERVER_STATE_STALE_TIME_MS,
  });
