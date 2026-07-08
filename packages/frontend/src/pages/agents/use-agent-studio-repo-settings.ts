import { useQuery } from "@tanstack/react-query";
import type { host } from "@/state/operations/host";
import { repoConfigQueryOptions, toRepoSettingsInput } from "@/state/queries/workspace";
import type { RepoSettingsInput } from "@/types/state-slices";

type RepoConfigQueryHost = Pick<typeof host, "workspaceGetRepoConfig">;

const INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY = "__inactive_workspace__";

export function useAgentStudioRepoSettings(args: {
  activeWorkspaceId: string | null;
  hostClient?: RepoConfigQueryHost;
}): {
  repoSettings: RepoSettingsInput | null;
  githubIntegrationEnabled: boolean;
  isLoadingRepoSettings: boolean;
} {
  const { activeWorkspaceId, hostClient } = args;
  const { data: repoSettingsResult, isLoading } = useQuery({
    ...repoConfigQueryOptions(
      activeWorkspaceId ?? INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY,
      hostClient,
    ),
    enabled: activeWorkspaceId !== null,
    select: (config) => ({
      repoSettings: toRepoSettingsInput(config),
      githubIntegrationEnabled: config.git.providers.github?.enabled === true,
    }),
  });
  const repoSettings =
    activeWorkspaceId !== null ? (repoSettingsResult?.repoSettings ?? null) : null;

  return {
    repoSettings,
    githubIntegrationEnabled:
      activeWorkspaceId !== null && repoSettingsResult?.githubIntegrationEnabled === true,
    isLoadingRepoSettings: activeWorkspaceId !== null && isLoading,
  };
}
