import { useQuery } from "@tanstack/react-query";
import { GITHUB_PROVIDER_DESCRIPTOR } from "@openducktor/contracts";
import type { host } from "@/state/operations/host";
import { repoConfigQueryOptions, toRepoSettingsInput } from "@/state/queries/workspace";
import type { RepoSettingsInput } from "@/types/state-slices";

type RepoConfigQueryHost = Pick<typeof host, "workspaceGetRepoConfig">;

const INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY = "__inactive_workspace__";

export function useAgentStudioRepoSettings(args: {
  activeWorkspaceId: string | null;
  hostClient?: RepoConfigQueryHost;
}) {
  const { activeWorkspaceId, hostClient } = args;
  const { data: repoSettingsResult, isLoading } = useQuery({
    ...repoConfigQueryOptions(
      activeWorkspaceId ?? INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY,
      hostClient,
    ),
    enabled: activeWorkspaceId !== null,
    select: (config) => {
      const provider = config.git.provider;
      return {
        repoSettings: toRepoSettingsInput(config),
        githubIntegrationEnabled:
          provider?.id === GITHUB_PROVIDER_DESCRIPTOR.id && provider.enabled === true,
      };
    },
  });
  const repoSettings =
    activeWorkspaceId !== null ? (repoSettingsResult?.repoSettings ?? null) : null;

  return {
    repoSettings,
    githubIntegrationEnabled:
      activeWorkspaceId !== null && repoSettingsResult?.githubIntegrationEnabled === true,
    isLoadingRepoSettings: activeWorkspaceId !== null && isLoading,
  } satisfies {
    repoSettings: RepoSettingsInput | null;
    githubIntegrationEnabled: boolean;
    isLoadingRepoSettings: boolean;
  };
}
