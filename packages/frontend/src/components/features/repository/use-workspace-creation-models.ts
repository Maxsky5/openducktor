import type {
  AgentModelFavorite,
  RuntimeDescriptor,
  RuntimeKind,
  SettingsSnapshot,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo, useState } from "react";
import type { ModelPickerFavoriteState } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useAgentModelFavorites } from "@openducktor/frontend-core/sessions/model-selection/use-agent-model-favorites";
import {
  type RuntimeModelCatalogQueryResource,
  useRuntimeModelCatalogs,
} from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

export type WorkspaceCreationModelSurface = {
  availableRuntimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
  favoriteState: ModelPickerFavoriteState;
  isLoadingRuntimeDefinitions: boolean;
  isLoadingCatalog: boolean;
  errors: string[];
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  retry: () => Promise<void>;
};

const NO_RUNTIME_KINDS: readonly RuntimeKind[] = [];

export function useWorkspaceCreationModels({
  repoPath,
  active,
  saveAgentModelFavorites,
}: {
  repoPath: string;
  active: boolean;
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<SettingsSnapshot>;
}): WorkspaceCreationModelSurface {
  const runtime = useRuntimeAvailabilityContext();
  const host = useHostClient();
  const favoriteState = useAgentModelFavorites({ saveAgentModelFavorites });
  const runtimeKinds = useMemo(
    () => runtime.availableRuntimeDefinitions.map((definition) => definition.kind),
    [runtime.availableRuntimeDefinitions],
  );
  const [retryError, setRetryError] = useState<string | null>(null);
  const { resources } = useRuntimeModelCatalogs({
    repoPath,
    runtimeKinds,
    enabledRuntimeKinds: active ? runtimeKinds : NO_RUNTIME_KINDS,
    agentRuntimes: runtime.agentRuntimes,
    loadPreviewModels: host.agentRuntimePreviewModels,
  });
  const errors = [
    ...(runtime.runtimeDefinitionsError
      ? [`Runtime definitions: ${runtime.runtimeDefinitionsError}`]
      : []),
    ...(runtime.runtimeSettingsError ? [`Runtime settings: ${runtime.runtimeSettingsError}`] : []),
    ...resources.flatMap((resource) =>
      resource.error ? [`${resource.runtimeKind}: ${resource.error}`] : [],
    ),
    ...(retryError ? [retryError] : []),
  ];

  return {
    availableRuntimeDefinitions: runtime.availableRuntimeDefinitions,
    catalogResources: resources,
    favoriteState,
    isLoadingRuntimeDefinitions:
      runtime.isLoadingRuntimeDefinitions || runtime.isLoadingRuntimeSettings,
    isLoadingCatalog: resources.some((resource) => resource.isLoading),
    errors,
    getCatalogForRuntime: (runtimeKind) => {
      const resource = resources.find((candidate) => candidate.runtimeKind === runtimeKind);
      return resource?.isEnabled ? resource.catalog : null;
    },
    isCatalogLoadingForRuntime: (runtimeKind) =>
      resources.find((resource) => resource.runtimeKind === runtimeKind)?.isLoading ?? false,
    retry: async () => {
      setRetryError(null);
      try {
        if (runtime.runtimeDefinitionsError) await runtime.refreshRuntimeDefinitions();
        if (runtime.runtimeSettingsError) await runtime.refreshRuntimeSettings();
        await Promise.all(
          resources
            .filter((resource) => resource.isEnabled && resource.error)
            .map((resource) => resource.retry()),
        );
      } catch (cause) {
        setRetryError(errorMessage(cause));
      }
    },
  };
}
