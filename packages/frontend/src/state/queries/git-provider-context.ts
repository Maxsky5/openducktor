import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { scheduleTask, type ScheduleTask } from "@/lib/scheduling";
import { host } from "@/state/operations/host";
import { withDiagnosticsQueryTimeout } from "./checks";
import { skippedQueryOptions } from "./skipped-query";

type RepositoryGitProviderContextHost = Pick<typeof host, "workspaceGetGitProviderContext">;

const REPOSITORY_GIT_PROVIDER_CONTEXT_STALE_TIME_MS = 30_000;

export const repositoryGitProviderContextQueryKeys = {
  all: ["repository-git-provider-context"] as const,
  repo: (repoPath: string | null) =>
    [...repositoryGitProviderContextQueryKeys.all, repoPath] as const,
};

export const repositoryGitProviderContextQueryOptions = (
  repoPath: string,
  hostClient: RepositoryGitProviderContextHost = host,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: repositoryGitProviderContextQueryKeys.repo(repoPath),
    queryFn: (): Promise<RepositoryGitProviderContext> =>
      withDiagnosticsQueryTimeout(hostClient.workspaceGetGitProviderContext(repoPath), scheduler),
    staleTime: REPOSITORY_GIT_PROVIDER_CONTEXT_STALE_TIME_MS,
  });

export const repositoryGitProviderContextQueryOptionsOrSkip = (
  repoPath: string | null,
  hostClient: RepositoryGitProviderContextHost = host,
) =>
  repoPath === null
    ? skippedQueryOptions<
        RepositoryGitProviderContext,
        ReturnType<typeof repositoryGitProviderContextQueryKeys.repo>
      >({
        queryKey: repositoryGitProviderContextQueryKeys.repo(null),
        staleTime: REPOSITORY_GIT_PROVIDER_CONTEXT_STALE_TIME_MS,
      })
    : repositoryGitProviderContextQueryOptions(repoPath, hostClient);
