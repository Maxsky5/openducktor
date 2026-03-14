import { useQuery } from "@tanstack/react-query";
import { repoConfigQueryOptions, toRepoSettingsInput } from "@/state/queries/workspace";
import type { RepoSettingsInput } from "@/types/state-slices";

export function useAgentStudioRepoSettings(args: { activeRepo: string | null }): {
  repoSettings: RepoSettingsInput | null;
} {
  const { activeRepo } = args;
  const { data: repoSettings } = useQuery({
    ...(activeRepo ? repoConfigQueryOptions(activeRepo) : repoConfigQueryOptions("")),
    enabled: activeRepo !== null,
    select: toRepoSettingsInput,
  });

  return {
    repoSettings: repoSettings ?? null,
  };
}
