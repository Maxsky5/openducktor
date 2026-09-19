import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { ActiveWorkspace, RefreshRepoRuntimeHealthOptions } from "@/types/state-slices";
import { classifyDiagnosticsQueryError, repoRuntimeHealthQueryOptions } from "../../queries/checks";
import { runtimeCatalogQueryKeys } from "../../queries/runtime-catalog";

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
  refreshRepoRuntimeHealth: (
    options?: RefreshRepoRuntimeHealthOptions,
  ) => Promise<RepoRuntimeHealthMap>;
};

const buildRuntimeHealthQueryErrorMap = (
  runtimeDefinitions: RuntimeDescriptor[],
  cause: unknown,
): RepoRuntimeHealthMap => {
  const checkedAt = new Date().toISOString();
  const { failureKind, message } = classifyDiagnosticsQueryError(cause);
  const entries = runtimeDefinitions.map((definition) => {
    const runtimeHealth: RepoRuntimeHealthCheck = {
      status: "error",
      checkedAt,
      runtime: {
        status: "error",
        stage: "startup_failed",
        observation: null,
        instance: null,
        startedAt: null,
        updatedAt: checkedAt,
        elapsedMs: null,
        attempts: null,
        detail: message,
        failureKind,
        failureReason: message,
      },
      mcp: definition.capabilities.optionalSurfaces.supportsMcpStatus
        ? {
            supported: true,
            status: "error",
            serverName: ODT_MCP_SERVER_NAME,
            serverStatus: null,
            toolIds: [],
            detail: "Runtime health check failed before MCP status could be read.",
            failureKind,
          }
        : null,
    };

    return [definition.kind, runtimeHealth] as const;
  });

  return Object.fromEntries(entries);
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

  const refreshRepoRuntimeHealth = useCallback(
    async (options?: RefreshRepoRuntimeHealthOptions): Promise<RepoRuntimeHealthMap> => {
      if (!activeRepoPath || runtimeDefinitions.length === 0) {
        return {};
      }

      const queryOptions = repoRuntimeHealthQueryOptions(
        activeRepoPath,
        runtimeDefinitions,
        checkRepoRuntimeHealth,
      );
      if (options?.reloadCatalogs) {
        // Refetch the catalogs of every mounted consumer scope, including session
        // worktree directories, and mark the cached but unmounted scopes stale for
        // the next read. Invalidate before the health read so the bootstrap reloads
        // the repository root when the health data changes.
        await queryClient.invalidateQueries({
          queryKey: runtimeCatalogQueryKeys.repoCatalogScope(activeRepoPath),
          refetchType: "active",
        });
      }
      await queryClient.invalidateQueries({
        queryKey: queryOptions.queryKey,
        exact: true,
        refetchType: "none",
      });
      const runtimeHealth = await queryClient.fetchQuery(queryOptions);
      return runtimeHealth;
    },
    [activeRepoPath, checkRepoRuntimeHealth, queryClient, runtimeDefinitions],
  );

  const activeRepoRuntimeHealthByRuntime = useMemo((): RepoRuntimeHealthMap => {
    if (activeRepoPath === null) {
      return {};
    }

    if (runtimeHealthQuery.data) {
      return runtimeHealthQuery.data;
    }

    if (runtimeHealthQuery.error) {
      return buildRuntimeHealthQueryErrorMap(runtimeDefinitions, runtimeHealthQuery.error);
    }

    return {};
  }, [activeRepoPath, runtimeDefinitions, runtimeHealthQuery.data, runtimeHealthQuery.error]);

  return {
    activeRepoRuntimeHealthByRuntime,
    isLoadingRepoRuntimeHealth:
      activeRepoPath !== null && runtimeDefinitions.length > 0 && runtimeHealthQuery.isFetching,
    refreshRepoRuntimeHealth,
  };
}
