import type { WorkspaceRecord } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { repoConfigQueryOptions, toRepoSettingsInput } from "@/state/queries/workspace";
import type { RepoSettingsInput } from "@/types/state-slices";

export function useAgentStudioRepoSettings(args: { activeWorkspace: WorkspaceRecord | null }): {
  repoSettings: RepoSettingsInput | null;
} {
  const { activeWorkspace } = args;
  const { data: repoSettings } = useQuery({
    ...(activeWorkspace
      ? repoConfigQueryOptions(activeWorkspace.workspaceId)
      : repoConfigQueryOptions("")),
    enabled: activeWorkspace !== null,
    select: toRepoSettingsInput,
  });

  return {
    repoSettings: repoSettings ?? null,
  };
}
