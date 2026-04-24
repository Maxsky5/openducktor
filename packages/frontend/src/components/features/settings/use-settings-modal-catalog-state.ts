import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { repoRuntimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";

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

export const useSettingsModalCatalogState = ({
  enabled,
  selectedRepoPath,
  runtimeKinds,
}: UseSettingsModalCatalogStateArgs): SettingsModalCatalogState => {
  const { loadRepoRuntimeCatalog } = useRuntimeDefinitionsContext();

  const catalogQueries = useQueries({
    queries: runtimeKinds.map((runtimeKind) => ({
      ...repoRuntimeCatalogQueryOptions(
        selectedRepoPath ?? "",
        runtimeKind,
        loadRepoRuntimeCatalog,
      ),
      enabled: enabled && Boolean(selectedRepoPath),
    })),
  });

  const catalogsByRuntime = useMemo<Record<string, AgentModelCatalog | null>>(() => {
    return Object.fromEntries(
      runtimeKinds.map((runtimeKind, index) => [runtimeKind, catalogQueries[index]?.data ?? null]),
    );
  }, [catalogQueries, runtimeKinds]);

  const catalogErrorsByRuntime = useMemo<Record<string, string | null>>(() => {
    return Object.fromEntries(
      runtimeKinds.map((runtimeKind, index) => {
        const queryError = catalogQueries[index]?.error;
        return [runtimeKind, queryError instanceof Error ? queryError.message : null];
      }),
    );
  }, [catalogQueries, runtimeKinds]);

  const loadingRuntimeKinds = useMemo<RuntimeKind[]>(() => {
    return runtimeKinds.filter((_runtimeKind, index) => catalogQueries[index]?.isLoading);
  }, [catalogQueries, runtimeKinds]);

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
