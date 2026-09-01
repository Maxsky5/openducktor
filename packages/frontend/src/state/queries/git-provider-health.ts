import type { GitProviderHealth } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "@/state/operations/host";

type GitProviderHealthHost = Pick<typeof host, "workspaceGetGitProviderHealth">;

const GIT_PROVIDER_HEALTH_STALE_TIME_MS = 30_000;

export const gitProviderHealthQueryKeys = {
  all: ["git-provider-health"] as const,
  repo: (repoPath: string) => [...gitProviderHealthQueryKeys.all, repoPath] as const,
};

export const gitProviderHealthQueryOptions = (
  repoPath: string,
  hostClient: GitProviderHealthHost = host,
) =>
  queryOptions({
    queryKey: gitProviderHealthQueryKeys.repo(repoPath),
    queryFn: (): Promise<GitProviderHealth> => hostClient.workspaceGetGitProviderHealth(repoPath),
    staleTime: GIT_PROVIDER_HEALTH_STALE_TIME_MS,
  });
