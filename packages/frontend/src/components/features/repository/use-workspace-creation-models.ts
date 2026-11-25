import type { AgentModelFavorite, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo, useState } from "react";
import { filterRuntimeDefinitionsForDefaultSelection } from "@openducktor/frontend-core/lib/agent-runtime";
import { useWorkflowSettings } from "@openducktor/frontend-core/queries/workflow-settings";
import type { ModelPickerFavoriteState } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { resolveRecommendedDefaultModel } from "@openducktor/frontend-core/sessions/model-selection/recommended-default-model";
import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useAgentModelFavorites } from "@openducktor/frontend-core/sessions/model-selection/use-agent-model-favorites";
import {
  type RuntimeModelCatalogQueryResource,
  useRuntimeModelCatalogs,
} from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import type { WorkspaceCreationController } from "./use-workspace-creation";

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
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<AgentModelFavorite[]>;
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

export function useWorkspaceCreationWithRecommendedDefault(
  controller: WorkspaceCreationController,
  modelSurface?: WorkspaceCreationModelSurface,
): WorkspaceCreationController {
  const workflows = useWorkflowSettings();
  const defaultRuntimeDefinitions = useMemo(
    () =>
      modelSurface
        ? filterRuntimeDefinitionsForDefaultSelection(
            modelSurface.availableRuntimeDefinitions,
            workflows.data?.roles.map(({ definition }) => definition) ?? [],
          )
        : [],
    [modelSurface, workflows.data],
  );
  const recommendedDefault = useMemo(
    () =>
      modelSurface
        ? resolveRecommendedDefaultModel({
            runtimeDefinitions: defaultRuntimeDefinitions,
            catalogResources: modelSurface.catalogResources,
          })
        : null,
    [defaultRuntimeDefinitions, modelSurface],
  );
  const shouldApplyRecommended =
    !controller.defaultModelTouched &&
    !controller.modelDraft.defaultModel &&
    recommendedDefault !== null;

  const effectiveModelDraft = useMemo(
    () =>
      shouldApplyRecommended
        ? { ...controller.modelDraft, defaultModel: { ...recommendedDefault.selection } }
        : controller.modelDraft,
    [controller.modelDraft, recommendedDefault, shouldApplyRecommended],
  );

  if (!shouldApplyRecommended) {
    return controller;
  }

  return {
    ...controller,
    modelDraft: effectiveModelDraft,
    updateModelDraft: (updater) =>
      controller.updateModelDraft((current) =>
        updater(
          !current.defaultModel
            ? { ...current, defaultModel: { ...recommendedDefault.selection } }
            : current,
        ),
      ),
    submit: () => controller.submit(recommendedDefault.selection),
  };
}
