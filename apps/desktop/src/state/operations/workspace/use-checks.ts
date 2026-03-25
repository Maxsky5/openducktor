import type {
  BeadsCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";
import {
  beadsCheckQueryOptions,
  checksQueryKeys,
  loadBeadsCheckFromQuery,
  loadRepoRuntimeHealthFromQuery,
  loadRuntimeCheckFromQuery,
  repoRuntimeHealthQueryOptions,
  runtimeCheckQueryOptions,
} from "../../queries/checks";
import { host } from "../shared/host";

type UseChecksArgs = {
  activeRepo: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>;
};

type UseChecksResult = {
  runtimeCheck: RuntimeCheck | null;
  activeBeadsCheck: BeadsCheck | null;
  activeRepoRuntimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
  setIsLoadingChecks: (value: boolean) => void;
  refreshRuntimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
  refreshRepoRuntimeHealthForRepo: (
    repoPath: string,
    force?: boolean,
  ) => Promise<RepoRuntimeHealthMap>;
  refreshChecks: () => Promise<void>;
  hasRuntimeCheck: () => boolean;
  hasCachedBeadsCheck: (repoPath: string) => boolean;
  hasCachedRepoRuntimeHealth: (repoPath: string, runtimeKinds: RuntimeKind[]) => boolean;
  clearActiveBeadsCheck: () => void;
  clearActiveRepoRuntimeHealth: () => void;
};

const buildRuntimeHealthErrorMap = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeHealthError: string,
  checkedAt: string,
): RepoRuntimeHealthMap => {
  return Object.fromEntries(
    runtimeDefinitions.map((definition) => [
      definition.kind,
      {
        runtimeOk: false,
        runtimeError: runtimeHealthError,
        runtime: null,
        mcpOk: false,
        mcpError: runtimeHealthError,
        mcpServerName: ODT_MCP_SERVER_NAME,
        mcpServerStatus: null,
        mcpServerError: runtimeHealthError,
        availableToolIds: [],
        checkedAt,
        errors: [runtimeHealthError],
      },
    ]),
  ) as RepoRuntimeHealthMap;
};

export function useChecks({
  activeRepo,
  runtimeDefinitions,
  checkRepoRuntimeHealth,
}: UseChecksArgs): UseChecksResult {
  const queryClient = useQueryClient();
  const [isManualLoadingChecks, setIsManualLoadingChecks] = useState(false);
  const runtimeCheckQuery = useQuery(runtimeCheckQueryOptions());
  const beadsCheckQuery = useQuery({
    ...beadsCheckQueryOptions(activeRepo ?? "__disabled__"),
    enabled: activeRepo !== null,
  });
  const runtimeHealthQuery = useQuery({
    ...repoRuntimeHealthQueryOptions(
      activeRepo ?? "__disabled__",
      runtimeDefinitions,
      checkRepoRuntimeHealth,
    ),
    enabled: activeRepo !== null && runtimeDefinitions.length > 0,
  });

  const refreshRuntimeCheck = useCallback(
    async (force = false): Promise<RuntimeCheck> => {
      if (force) {
        const check = await host.runtimeCheck(true);
        queryClient.setQueryData(checksQueryKeys.runtime(), check);
        return check;
      }

      return loadRuntimeCheckFromQuery(queryClient);
    },
    [queryClient],
  );

  const refreshBeadsCheckForRepo = useCallback(
    async (repoPath: string, force = false): Promise<BeadsCheck> => {
      if (force) {
        await queryClient.invalidateQueries({
          queryKey: checksQueryKeys.beads(repoPath),
          exact: true,
          refetchType: "none",
        });
      }

      return force
        ? queryClient.fetchQuery(beadsCheckQueryOptions(repoPath))
        : loadBeadsCheckFromQuery(queryClient, repoPath);
    },
    [queryClient],
  );

  const refreshRepoRuntimeHealthForRepo = useCallback(
    async (repoPath: string, force = false): Promise<RepoRuntimeHealthMap> => {
      if (runtimeDefinitions.length === 0) {
        return {};
      }

      const queryOptions = repoRuntimeHealthQueryOptions(
        repoPath,
        runtimeDefinitions,
        checkRepoRuntimeHealth,
      );

      if (force) {
        await queryClient.invalidateQueries({
          queryKey: queryOptions.queryKey,
          exact: true,
          refetchType: "none",
        });
        return queryClient.fetchQuery(queryOptions);
      }

      return loadRepoRuntimeHealthFromQuery(
        queryClient,
        repoPath,
        runtimeDefinitions,
        checkRepoRuntimeHealth,
      );
    },
    [checkRepoRuntimeHealth, queryClient, runtimeDefinitions],
  );

  const refreshChecks = useCallback(async (): Promise<void> => {
    if (!activeRepo) {
      return;
    }

    setIsManualLoadingChecks(true);
    try {
      const runtime = await refreshRuntimeCheck(true);
      const beads = await refreshBeadsCheckForRepo(activeRepo, true);
      const runtimeHealthByRuntime = await refreshRepoRuntimeHealthForRepo(activeRepo, true);
      const runtimesHealthy = runtime.runtimes.every((runtimeEntry) => runtimeEntry.ok);
      const runtimeHealthEntries = runtimeDefinitions.map(
        (definition) => runtimeHealthByRuntime[definition.kind],
      );
      const runtimeServersHealthy = runtimeHealthEntries.every(
        (entry) => entry?.runtimeOk !== false,
      );
      const runtimeMcpHealthy = runtimeDefinitions.every((definition) => {
        const health = runtimeHealthByRuntime[definition.kind];
        if (!definition.capabilities.supportsMcpStatus) {
          return true;
        }
        return health?.mcpOk !== false;
      });
      if (
        !runtime.gitOk ||
        !runtimesHealthy ||
        !beads.beadsOk ||
        !runtimeServersHealthy ||
        !runtimeMcpHealthy
      ) {
        const details = [
          ...runtime.errors,
          ...(beads.beadsError ? [`beads: ${beads.beadsError}`] : []),
          ...runtimeHealthEntries.flatMap((entry) => entry?.errors ?? []),
        ].join(" | ");
        toast.error("Diagnostics check failed", { description: details });
      }
    } catch (error) {
      toast.error("Diagnostics check unavailable", { description: errorMessage(error) });
    } finally {
      setIsManualLoadingChecks(false);
    }
  }, [
    activeRepo,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshRuntimeCheck,
    runtimeDefinitions,
  ]);

  const hasCachedBeadsCheck = useCallback(
    (repoPath: string): boolean => {
      return queryClient.getQueryData(beadsCheckQueryOptions(repoPath).queryKey) !== undefined;
    },
    [queryClient],
  );

  const hasCachedRepoRuntimeHealth = useCallback(
    (repoPath: string, runtimeKinds: RuntimeKind[]): boolean => {
      return (
        queryClient.getQueryData(checksQueryKeys.runtimeHealth(repoPath, runtimeKinds)) !==
        undefined
      );
    },
    [queryClient],
  );

  const hasRuntimeCheck = useCallback((): boolean => {
    return queryClient.getQueryData(runtimeCheckQueryOptions().queryKey) !== undefined;
  }, [queryClient]);

  const clearActiveBeadsCheck = useCallback(() => {
    setIsManualLoadingChecks(false);
    if (activeRepo === null) {
      return;
    }
    queryClient.removeQueries({
      queryKey: checksQueryKeys.beads(activeRepo),
      exact: true,
    });
  }, [activeRepo, queryClient]);

  const clearActiveRepoRuntimeHealth = useCallback(() => {
    setIsManualLoadingChecks(false);
    if (activeRepo === null || runtimeDefinitions.length === 0) {
      return;
    }
    queryClient.removeQueries({
      queryKey: checksQueryKeys.runtimeHealth(
        activeRepo,
        runtimeDefinitions.map((definition) => definition.kind),
      ),
      exact: true,
    });
  }, [activeRepo, queryClient, runtimeDefinitions]);

  const activeRepoRuntimeHealthByRuntime = useMemo((): RepoRuntimeHealthMap => {
    if (activeRepo === null) {
      return {};
    }

    if (runtimeHealthQuery.error && runtimeDefinitions.length > 0) {
      const runtimeHealthError = errorMessage(runtimeHealthQuery.error);
      const checkedAt =
        runtimeHealthQuery.errorUpdatedAt > 0
          ? new Date(runtimeHealthQuery.errorUpdatedAt).toISOString()
          : new Date().toISOString();
      return buildRuntimeHealthErrorMap(runtimeDefinitions, runtimeHealthError, checkedAt);
    }

    if (runtimeHealthQuery.data) {
      return runtimeHealthQuery.data;
    }

    return {};
  }, [
    activeRepo,
    runtimeDefinitions,
    runtimeHealthQuery.data,
    runtimeHealthQuery.error,
    runtimeHealthQuery.errorUpdatedAt,
  ]);
  const isLoadingChecks =
    isManualLoadingChecks ||
    runtimeCheckQuery.isFetching ||
    (activeRepo !== null &&
      (beadsCheckQuery.isFetching ||
        (runtimeDefinitions.length > 0 && runtimeHealthQuery.isFetching)));

  return {
    runtimeCheck: runtimeCheckQuery.data ?? null,
    activeBeadsCheck: activeRepo === null ? null : (beadsCheckQuery.data ?? null),
    activeRepoRuntimeHealthByRuntime,
    isLoadingChecks,
    setIsLoadingChecks: setIsManualLoadingChecks,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoRuntimeHealth,
    clearActiveBeadsCheck,
    clearActiveRepoRuntimeHealth,
  };
}
