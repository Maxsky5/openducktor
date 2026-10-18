import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { useCallback, useMemo } from "react";
import {
  repositoryGitProviderContextQueryOptions,
  repositoryGitProviderContextQueryOptionsOrSkip,
} from "@openducktor/frontend-core/queries/git-provider-context";
import {
  repoConfigQueryOptions,
  toRepoSettingsInput,
} from "@openducktor/frontend-core/queries/workspace";
import type { RepoSettingsInput } from "@/types/state-slices";

const INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY = "__inactive_workspace__";

export function useAgentStudioRepoSettings(args: {
  activeWorkspaceId: string | null;
  activeRepoPath: string | null;
}) {
  const { activeRepoPath, activeWorkspaceId } = args;
  const queryClient = useQueryClient();
  const repoConfigQuery = useQuery({
    ...repoConfigQueryOptions(activeWorkspaceId ?? INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY),
    enabled: activeWorkspaceId !== null,
  });
  const repoConfig = repoConfigQuery.data;
  const loadRepoSettings = useCallback(async (): Promise<RepoSettingsInput> => {
    if (activeWorkspaceId === null)
      throw new Error("Select a workspace before loading repository settings.");
    const config = await queryClient.fetchQuery({
      ...repoConfigQueryOptions(activeWorkspaceId),
      staleTime: 0,
    });
    return toRepoSettingsInput(config);
  }, [activeWorkspaceId, queryClient]);
  const providerContextQuery = useQuery(
    repositoryGitProviderContextQueryOptionsOrSkip(activeRepoPath),
  );
  const repoSettings = useMemo(
    () => (activeWorkspaceId !== null && repoConfig ? toRepoSettingsInput(repoConfig) : null),
    [activeWorkspaceId, repoConfig],
  );
  const gitProviderContext = activeRepoPath !== null ? providerContextQuery.data : undefined;
  const gitProviderContextError =
    activeRepoPath !== null && providerContextQuery.isError ? providerContextQuery.error : null;
  const refetchGitProviderContext = providerContextQuery.refetch;
  const loadGitProviderContext = useCallback((): Promise<RepositoryGitProviderContext> => {
    if (activeRepoPath === null) {
      return Promise.reject(new Error("Select a repository before loading Git provider context."));
    }
    return queryClient.fetchQuery({
      ...repositoryGitProviderContextQueryOptions(activeRepoPath),
      staleTime: 0,
    });
  }, [activeRepoPath, queryClient]);
  const retryGitProviderContext = useCallback((): void => {
    void refetchGitProviderContext();
  }, [refetchGitProviderContext]);

  return {
    repoSettings,
    repoSettingsError:
      activeWorkspaceId !== null && repoConfigQuery.isError ? repoConfigQuery.error : null,
    loadRepoSettings,
    gitProvider: {
      context: gitProviderContext,
      error: gitProviderContextError,
      load: loadGitProviderContext,
      retry: retryGitProviderContext,
    },
    isLoadingRepoSettings: activeWorkspaceId !== null && repoConfigQuery.isLoading,
  } satisfies {
    repoSettings: RepoSettingsInput | null;
    repoSettingsError: Error | null;
    loadRepoSettings: () => Promise<RepoSettingsInput>;
    gitProvider: {
      context: RepositoryGitProviderContext | undefined;
      error: Error | null;
      load: () => Promise<RepositoryGitProviderContext>;
      retry: () => void;
    };
    isLoadingRepoSettings: boolean;
  };
}
