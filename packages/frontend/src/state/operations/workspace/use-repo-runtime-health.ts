import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import { classifyDiagnosticsQueryError, repoRuntimeHealthQueryOptions } from "../../queries/checks";

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

const buildRuntimeHealthQueryErrorMap = (
  runtimeDefinitions: RuntimeDescriptor[],
  error: unknown,
): RepoRuntimeHealthMap => {
  const checkedAt = new Date().toISOString();
  const { failureKind, message } = classifyDiagnosticsQueryError(error);
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
