import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { useCallback } from "react";
import type { host } from "@/state/operations/host";
import {
  repositoryGitProviderContextQueryOptions,
  repositoryGitProviderContextQueryOptionsOrSkip,
} from "@/state/queries/git-provider-context";
import { repoConfigQueryOptions, toRepoSettingsInput } from "@/state/queries/workspace";
import type { RepoSettingsInput } from "@/types/state-slices";

type RepoConfigQueryHost = Pick<
  typeof host,
  "workspaceGetGitProviderContext" | "workspaceGetRepoConfig"
>;

const INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY = "__inactive_workspace__";

export function useAgentStudioRepoSettings(args: {
  activeWorkspaceId: string | null;
  activeRepoPath: string | null;
  hostClient?: RepoConfigQueryHost;
}) {
  const { activeRepoPath, activeWorkspaceId, hostClient } = args;
  const queryClient = useQueryClient();
  const { data: repoConfig, isLoading: isLoadingRepoConfig } = useQuery({
    ...repoConfigQueryOptions(
      activeWorkspaceId ?? INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY,
      hostClient,
    ),
    enabled: activeWorkspaceId !== null,
  });
  const providerContextQuery = useQuery(
    repositoryGitProviderContextQueryOptionsOrSkip(activeRepoPath, hostClient),
  );
  const repoSettings =
    activeWorkspaceId !== null && repoConfig ? toRepoSettingsInput(repoConfig) : null;
  const gitProviderContext = activeRepoPath !== null ? providerContextQuery.data : undefined;
  const gitProviderContextError =
    activeRepoPath !== null && providerContextQuery.isError ? providerContextQuery.error : null;
  const refetchGitProviderContext = providerContextQuery.refetch;
  const loadGitProviderContext = useCallback((): Promise<RepositoryGitProviderContext> => {
    if (activeRepoPath === null) {
      return Promise.reject(new Error("Select a repository before loading Git provider context."));
    }
    return queryClient.fetchQuery(
      repositoryGitProviderContextQueryOptions(activeRepoPath, hostClient),
    );
  }, [activeRepoPath, hostClient, queryClient]);
  const retryGitProviderContext = useCallback((): void => {
    void refetchGitProviderContext();
  }, [refetchGitProviderContext]);

  return {
    repoSettings,
    gitProvider: {
      context: gitProviderContext,
      error: gitProviderContextError,
      load: loadGitProviderContext,
      retry: retryGitProviderContext,
    },
    isLoadingRepoSettings: activeWorkspaceId !== null && isLoadingRepoConfig,
  } satisfies {
    repoSettings: RepoSettingsInput | null;
    gitProvider: {
      context: RepositoryGitProviderContext | undefined;
      error: Error | null;
      load: () => Promise<RepositoryGitProviderContext>;
      retry: () => void;
    };
    isLoadingRepoSettings: boolean;
  };
}
