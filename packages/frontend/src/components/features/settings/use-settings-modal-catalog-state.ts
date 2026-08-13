import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo } from "react";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import {
  type RuntimeModelCatalogResource,
  useRuntimeModelCatalogs,
} from "@/state/queries/use-runtime-model-catalogs";

type UseSettingsModalCatalogStateArgs = {
  enabled: boolean;
  selectedRepoPath: string | null;
  runtimeKinds: RuntimeKind[];
};

type SettingsModalCatalogState = {
  resources: RuntimeModelCatalogResource[];
  catalogsByRuntime: Record<string, AgentModelCatalog | null>;
  catalogErrorsByRuntime: Record<string, string | null>;
  isLoadingCatalog: boolean;
  loadingRuntimeKinds: RuntimeKind[];
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  getCatalogErrorForRuntime: (runtimeKind: RuntimeKind) => string | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
};

const EMPTY_RUNTIME_KINDS: RuntimeKind[] = [];

export const useSettingsModalCatalogState = ({
  enabled,
  selectedRepoPath,
  runtimeKinds,
}: UseSettingsModalCatalogStateArgs): SettingsModalCatalogState => {
  const { loadRepoRuntimeCatalog } = useRuntimeDefinitionsContext();
  const { resources } = useRuntimeModelCatalogs({
    repoPath: selectedRepoPath,
    runtimeKinds,
    enabledRuntimeKinds: enabled ? runtimeKinds : EMPTY_RUNTIME_KINDS,
    loadCatalog: loadRepoRuntimeCatalog,
  });
  const { catalogsByRuntime, catalogErrorsByRuntime, loadingRuntimeKinds } = useMemo(() => {
    const catalogs: Record<string, AgentModelCatalog | null> = {};
    const errors: Record<string, string | null> = {};
    const loading: RuntimeKind[] = [];
    for (const resource of resources) {
      catalogs[resource.runtimeKind] = resource.catalog;
      errors[resource.runtimeKind] = resource.error;
      if (resource.isLoading) {
        loading.push(resource.runtimeKind);
      }
    }
    return {
      catalogsByRuntime: catalogs,
      catalogErrorsByRuntime: errors,
      loadingRuntimeKinds: loading,
    };
  }, [resources]);

  return {
    resources,
    catalogsByRuntime,
    catalogErrorsByRuntime,
    isLoadingCatalog: loadingRuntimeKinds.length > 0,
    loadingRuntimeKinds,
    getCatalogForRuntime: (runtimeKind) => catalogsByRuntime[runtimeKind] ?? null,
    getCatalogErrorForRuntime: (runtimeKind) => catalogErrorsByRuntime[runtimeKind] ?? null,
    isCatalogLoadingForRuntime: (runtimeKind) => loadingRuntimeKinds.includes(runtimeKind),
  };
};
