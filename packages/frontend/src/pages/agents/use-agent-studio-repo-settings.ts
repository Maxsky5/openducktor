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
} {
  const { activeWorkspaceId, hostClient } = args;
  const { data: repoSettings } = useQuery({
    ...repoConfigQueryOptions(
      activeWorkspaceId ?? INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY,
      hostClient,
    ),
    enabled: activeWorkspaceId !== null,
    select: toRepoSettingsInput,
  });

  return {
    repoSettings: activeWorkspaceId !== null ? (repoSettings ?? null) : null,
  };
}
