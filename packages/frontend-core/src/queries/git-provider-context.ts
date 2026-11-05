import { workspaceScopeValue } from "./workspace-scope";
import type { RepositoryGitProviderContext, WorkspaceRef } from "@openducktor/contracts";
import { type QueryKey, queryOptions } from "@tanstack/react-query";
import { scheduleTask, type ScheduleTask } from "../lib/scheduling";
import { connectionHost } from "../connection/client-connection";
import { withDiagnosticsQueryTimeout } from "./checks";
import { skippedQueryOptions } from "./skipped-query";

const REPOSITORY_GIT_PROVIDER_CONTEXT_STALE_TIME_MS = 30_000;

export const repositoryGitProviderContextQueryKeys = {
  all: ["repository-git-provider-context"] as const,
  repo: (scope: WorkspaceRef | null) =>
    [
      ...repositoryGitProviderContextQueryKeys.all,
      scope ? workspaceScopeValue(scope) : null,
    ] as const,
};

export const repositoryGitProviderContextQueryOptions = (
  scope: WorkspaceRef,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions<RepositoryGitProviderContext, Error, RepositoryGitProviderContext, QueryKey>({
    queryKey: repositoryGitProviderContextQueryKeys.repo(scope),
    queryFn: ({ client, signal }): Promise<RepositoryGitProviderContext> =>
      withDiagnosticsQueryTimeout(
        (timeoutSignal) =>
          connectionHost(client).workspaceGetGitProviderContext(scope, { signal: timeoutSignal }),
        scheduler,
        signal,
      ),
    staleTime: REPOSITORY_GIT_PROVIDER_CONTEXT_STALE_TIME_MS,
  });

export const repositoryGitProviderContextQueryOptionsOrSkip = (scope: WorkspaceRef | null) =>
  scope === null
    ? skippedQueryOptions<RepositoryGitProviderContext, QueryKey>({
        queryKey: repositoryGitProviderContextQueryKeys.repo(null),
        staleTime: REPOSITORY_GIT_PROVIDER_CONTEXT_STALE_TIME_MS,
      })
    : repositoryGitProviderContextQueryOptions(scope);
