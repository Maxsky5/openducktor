import type {
  AgentModelFavorite,
  RuntimeDescriptor,
  RuntimeKind,
  SettingsSnapshot,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo, useState } from "react";
import type { ModelPickerFavoriteState } from "@/components/features/agents/model-picker";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { useAgentModelFavorites } from "@/state/mutations/use-agent-model-favorites";
import { host } from "@/state/operations/shared/host";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceCreationPreviewCatalogs } from "./use-workspace-creation-preview-catalogs";

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
  const favoriteState = useAgentModelFavorites({ saveAgentModelFavorites });
  const runtimeKinds = useMemo(
    () => runtime.availableRuntimeDefinitions.map((definition) => definition.kind),
    [runtime.availableRuntimeDefinitions],
  );
  const [retryError, setRetryError] = useState<string | null>(null);
  const resources = useWorkspaceCreationPreviewCatalogs({
    repoPath,
    active,
    runtimeKinds,
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
    isLoadingCatalog: resources.some((resource) => resource.isFetching),
    errors,
    getCatalogForRuntime: (runtimeKind) => {
      const resource = resources.find((candidate) => candidate.runtimeKind === runtimeKind);
      return resource?.isEnabled && !resource.error ? resource.catalog : null;
    },
    isCatalogLoadingForRuntime: (runtimeKind) =>
      resources.find((resource) => resource.runtimeKind === runtimeKind)?.isFetching ?? false,
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
