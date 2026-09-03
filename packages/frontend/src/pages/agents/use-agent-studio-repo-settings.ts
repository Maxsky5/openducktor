import { useQuery } from "@tanstack/react-query";
import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import type { host } from "@/state/operations/host";
import { repositoryGitProviderContextQueryOptions } from "@/state/queries/git-provider-context";
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
  const { data: repoConfig, isLoading: isLoadingRepoConfig } = useQuery({
    ...repoConfigQueryOptions(
      activeWorkspaceId ?? INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY,
      hostClient,
    ),
    enabled: activeWorkspaceId !== null,
  });
  const providerContextQuery = useQuery({
    ...repositoryGitProviderContextQueryOptions(
      activeRepoPath ?? "__inactive_repository__",
      hostClient,
    ),
    enabled: activeRepoPath !== null,
  });
  const repoSettings =
    activeWorkspaceId !== null && repoConfig ? toRepoSettingsInput(repoConfig) : null;
  const gitProviderContext = activeRepoPath !== null ? (providerContextQuery.data ?? null) : null;

  return {
    repoSettings,
    gitProviderContext,
    isLoadingGitProviderContext: activeRepoPath !== null && providerContextQuery.isLoading,
    isLoadingRepoSettings: activeWorkspaceId !== null && isLoadingRepoConfig,
  } satisfies {
    repoSettings: RepoSettingsInput | null;
    gitProviderContext: RepositoryGitProviderContext;
    isLoadingGitProviderContext: boolean;
    isLoadingRepoSettings: boolean;
  };
}
