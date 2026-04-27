import type { WorkspaceRecord } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import type { host } from "@/state/operations/host";
import { repoConfigQueryOptions, toRepoSettingsInput } from "@/state/queries/workspace";
import type { RepoSettingsInput } from "@/types/state-slices";

type RepoConfigQueryHost = Pick<typeof host, "workspaceGetRepoConfig">;

export function useAgentStudioRepoSettings(args: {
  activeWorkspace: WorkspaceRecord | null;
  hostClient?: RepoConfigQueryHost;
}): {
  repoSettings: RepoSettingsInput | null;
} {
  const { activeWorkspace, hostClient } = args;
  const { data: repoSettings } = useQuery({
    ...(activeWorkspace
      ? repoConfigQueryOptions(activeWorkspace.workspaceId, hostClient)
      : repoConfigQueryOptions("", hostClient)),
    enabled: activeWorkspace !== null,
    select: toRepoSettingsInput,
  });

  return {
    repoSettings: repoSettings ?? null,
  };
}
