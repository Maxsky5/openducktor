import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { scheduleTask, type ScheduleTask } from "../lib/scheduling";
import { connectionHost } from "../connection/client-connection";
import { withDiagnosticsQueryTimeout } from "./checks";
import { skippedQueryOptions } from "./skipped-query";

const REPOSITORY_GIT_PROVIDER_CONTEXT_STALE_TIME_MS = 30_000;

export const repositoryGitProviderContextQueryKeys = {
  all: ["repository-git-provider-context"] as const,
  repo: (repoPath: string | null) =>
    [...repositoryGitProviderContextQueryKeys.all, repoPath] as const,
};

export const repositoryGitProviderContextQueryOptions = (
  repoPath: string,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: repositoryGitProviderContextQueryKeys.repo(repoPath),
    queryFn: ({ client }): Promise<RepositoryGitProviderContext> =>
      withDiagnosticsQueryTimeout(
        connectionHost(client).workspaceGetGitProviderContext(repoPath),
        scheduler,
      ),
    staleTime: REPOSITORY_GIT_PROVIDER_CONTEXT_STALE_TIME_MS,
  });

export const repositoryGitProviderContextQueryOptionsOrSkip = (repoPath: string | null) =>
  repoPath === null
    ? skippedQueryOptions<
        RepositoryGitProviderContext,
        ReturnType<typeof repositoryGitProviderContextQueryKeys.repo>
      >({
        queryKey: repositoryGitProviderContextQueryKeys.repo(null),
        staleTime: REPOSITORY_GIT_PROVIDER_CONTEXT_STALE_TIME_MS,
      })
    : repositoryGitProviderContextQueryOptions(repoPath);
