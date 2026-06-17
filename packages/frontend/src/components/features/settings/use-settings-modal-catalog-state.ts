import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import {
  RUNTIME_CATALOG_STALE_TIME_MS,
  repoRuntimeCatalogQueryOptions,
  runtimeCatalogQueryKeys,
} from "@/state/queries/runtime-catalog";
import { skippedQueryOptions } from "@/state/queries/skipped-query";

type UseSettingsModalCatalogStateArgs = {
  enabled: boolean;
  selectedRepoPath: string | null;
  runtimeKinds: RuntimeKind[];
};

type SettingsModalCatalogState = {
  catalogsByRuntime: Record<string, AgentModelCatalog | null>;
  catalogErrorsByRuntime: Record<string, string | null>;
  isLoadingCatalog: boolean;
  loadingRuntimeKinds: RuntimeKind[];
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  getCatalogErrorForRuntime: (runtimeKind: RuntimeKind) => string | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
};

const skippedSettingsCatalogQueryOptions = (runtimeRef: RepoRuntimeRef | null) =>
  skippedQueryOptions<AgentModelCatalog>({
    queryKey: runtimeRef
      ? runtimeCatalogQueryKeys.repo(runtimeRef.repoPath, runtimeRef.runtimeKind)
      : runtimeCatalogQueryKeys.all,
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const useSettingsModalCatalogState = ({
  enabled,
  selectedRepoPath,
  runtimeKinds,
}: UseSettingsModalCatalogStateArgs): SettingsModalCatalogState => {
  const { loadRepoRuntimeCatalog } = useRuntimeDefinitionsContext();
  const uniqueRuntimeKinds = useMemo(() => Array.from(new Set(runtimeKinds)), [runtimeKinds]);

  const catalogQueries = useQueries({
    queries: uniqueRuntimeKinds.map((runtimeKind) => {
      const runtimeRef: RepoRuntimeRef | null = selectedRepoPath
        ? {
            repoPath: selectedRepoPath,
            runtimeKind,
          }
        : null;
      return enabled && runtimeRef
        ? repoRuntimeCatalogQueryOptions(runtimeRef, loadRepoRuntimeCatalog)
        : skippedSettingsCatalogQueryOptions(runtimeRef);
    }),
  });

  const catalogsByRuntime = useMemo<Record<string, AgentModelCatalog | null>>(() => {
    return Object.fromEntries(
      uniqueRuntimeKinds.map((runtimeKind, index) => [
        runtimeKind,
        catalogQueries[index]?.data ?? null,
      ]),
    );
  }, [catalogQueries, uniqueRuntimeKinds]);

  const catalogErrorsByRuntime = useMemo<Record<string, string | null>>(() => {
    return Object.fromEntries(
      uniqueRuntimeKinds.map((runtimeKind, index) => {
        const queryError = catalogQueries[index]?.error;
        return [runtimeKind, queryError instanceof Error ? queryError.message : null];
      }),
    );
  }, [catalogQueries, uniqueRuntimeKinds]);

  const loadingRuntimeKinds = useMemo<RuntimeKind[]>(() => {
    return uniqueRuntimeKinds.filter((_runtimeKind, index) => catalogQueries[index]?.isLoading);
  }, [catalogQueries, uniqueRuntimeKinds]);

  return {
    catalogsByRuntime,
    catalogErrorsByRuntime,
    isLoadingCatalog: loadingRuntimeKinds.length > 0,
    loadingRuntimeKinds,
    getCatalogForRuntime: (runtimeKind) => catalogsByRuntime[runtimeKind] ?? null,
    getCatalogErrorForRuntime: (runtimeKind) => catalogErrorsByRuntime[runtimeKind] ?? null,
    isCatalogLoadingForRuntime: (runtimeKind) => loadingRuntimeKinds.includes(runtimeKind),
  };
};
