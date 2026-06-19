import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import { repoRuntimeHealthQueryOptions } from "../../queries/checks";

type UseRepoRuntimeHealthArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeDefinitions: RuntimeDescriptor[];
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>;
};

type UseRepoRuntimeHealthResult = {
  activeRepoRuntimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingRepoRuntimeHealth: boolean;
  refreshRepoRuntimeHealth: () => Promise<RepoRuntimeHealthMap>;
};

export function useRepoRuntimeHealth({
  activeWorkspace,
  runtimeDefinitions,
  checkRepoRuntimeHealth,
}: UseRepoRuntimeHealthArgs): UseRepoRuntimeHealthResult {
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const queryClient = useQueryClient();
  const runtimeHealthQueryOptions = repoRuntimeHealthQueryOptions(
    activeRepoPath ?? "__disabled__",
    runtimeDefinitions,
    checkRepoRuntimeHealth,
  );
  const runtimeHealthQuery = useQuery({
    ...runtimeHealthQueryOptions,
    enabled: activeRepoPath !== null && runtimeDefinitions.length > 0,
  });

  const refreshRepoRuntimeHealth = useCallback(async (): Promise<RepoRuntimeHealthMap> => {
    if (!activeRepoPath || runtimeDefinitions.length === 0) {
      return {};
    }

    const queryOptions = repoRuntimeHealthQueryOptions(
      activeRepoPath,
      runtimeDefinitions,
      checkRepoRuntimeHealth,
    );
    await queryClient.invalidateQueries({
      queryKey: queryOptions.queryKey,
      exact: true,
      refetchType: "none",
    });
    return queryClient.fetchQuery(queryOptions);
  }, [activeRepoPath, checkRepoRuntimeHealth, queryClient, runtimeDefinitions]);

  const activeRepoRuntimeHealthByRuntime = useMemo((): RepoRuntimeHealthMap => {
    if (activeRepoPath === null) {
      return {};
    }

    return runtimeHealthQuery.data ?? {};
  }, [activeRepoPath, runtimeHealthQuery.data]);

  return {
    activeRepoRuntimeHealthByRuntime,
    isLoadingRepoRuntimeHealth:
      activeRepoPath !== null && runtimeDefinitions.length > 0 && runtimeHealthQuery.isFetching,
    refreshRepoRuntimeHealth,
  };
}
