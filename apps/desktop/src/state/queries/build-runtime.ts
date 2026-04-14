import type { BuildContinuationTarget } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

type BuildContinuationTargetQueryHost = Pick<typeof host, "buildContinuationTargetGet">;

const BUILD_CONTINUATION_TARGET_STALE_TIME_MS = 30_000;

export const buildRuntimeQueryKeys = {
  all: ["build-runtime"] as const,
  continuationTarget: (repoPath: string, taskId: string) =>
    [...buildRuntimeQueryKeys.all, "continuation-target", repoPath, taskId] as const,
};

export const buildContinuationTargetQueryOptions = (
  repoPath: string,
  taskId: string,
  hostClient: BuildContinuationTargetQueryHost = host,
) =>
  queryOptions({
    queryKey: buildRuntimeQueryKeys.continuationTarget(repoPath, taskId),
    queryFn: (): Promise<BuildContinuationTarget | null> =>
      hostClient.buildContinuationTargetGet(repoPath, taskId),
    staleTime: BUILD_CONTINUATION_TARGET_STALE_TIME_MS,
  });
