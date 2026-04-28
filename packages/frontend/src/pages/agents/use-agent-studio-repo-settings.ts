import type { WorkspaceRecord } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import type { host } from "@/state/operations/host";
import { repoConfigQueryOptions, toRepoSettingsInput } from "@/state/queries/workspace";
import type { RepoSettingsInput } from "@/types/state-slices";

type RepoConfigQueryHost = Pick<typeof host, "workspaceGetRepoConfig">;

const INACTIVE_WORKSPACE_REPO_CONFIG_QUERY_KEY = "__inactive_workspace__";

export function useAgentStudioRepoSettings(args: {
  activeWorkspace: WorkspaceRecord | null;
  hostClient?: RepoConfigQueryHost;
}): {
  repoSettings: RepoSettingsInput | null;
} {
  const { activeWorkspace, hostClient } = args;
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
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
