import { useWorkflowSettings } from "@openducktor/frontend-core/queries/workflow-settings";
import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type ReactElement, useMemo } from "react";
import type { ModelPickerFavoriteState } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { filterRuntimeDefinitionsForDefaultSelection } from "@openducktor/frontend-core/lib/agent-runtime";
import type { RuntimeModelCatalogQueryResource } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import type { WorkspaceModelDefaultsDraft } from "@/types/state-slices";
import { RepositoryModelBlock } from "./repository-model-block";
import { selectPickedModel } from "./repository-agent-selection";

type RepositoryDefaultModelBlockProps = {
  presentation?: "settings" | "creation";
  selectedRepoConfig: WorkspaceModelDefaultsDraft;
  availableRuntimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
  favoriteState: ModelPickerFavoriteState;
  loadingState: {
    isLoadingSettings: boolean;
    isSaving: boolean;
  };
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  onUpdateSelectedRepoConfig: (
    updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft,
  ) => void;
  onUpdateSelectedRepoDefaultModel: (
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
    value: string,
  ) => void;
  onClearSelectedRepoDefaultModel: () => void;
};

export function RepositoryDefaultModelBlock({
  presentation = "settings",
  selectedRepoConfig,
  availableRuntimeDefinitions,
  catalogResources,
  favoriteState,
  loadingState,
  getCatalogForRuntime,
  isCatalogLoadingForRuntime,
  onUpdateSelectedRepoConfig,
  onUpdateSelectedRepoDefaultModel,
  onClearSelectedRepoDefaultModel,
}: RepositoryDefaultModelBlockProps): ReactElement {
  const workflows = useWorkflowSettings();
  const runtimeDefinitions = useMemo(
    () =>
      filterRuntimeDefinitionsForDefaultSelection(
        availableRuntimeDefinitions,
        workflows.data?.roles.map(({ definition }) => definition) ?? [],
      ),
    [availableRuntimeDefinitions, workflows.data],
  );
  return (
    <RepositoryModelBlock
      title="Default model"
      description="Used for new sessions and for task sessions that have no role default."
      presentation={presentation}
      showProfile
      value={selectedRepoConfig.defaultModel ?? null}
      runtimeDefinitions={runtimeDefinitions}
      catalogResources={catalogResources}
      favoriteState={favoriteState}
      loadingState={loadingState}
      getCatalogForRuntime={getCatalogForRuntime}
      isCatalogLoadingForRuntime={isCatalogLoadingForRuntime}
      onSelectModel={(value, targetCatalog) =>
        onUpdateSelectedRepoConfig((repoConfig) => {
          const nextDefault = selectPickedModel(repoConfig.defaultModel, value, targetCatalog);
          return nextDefault ? { ...repoConfig, defaultModel: nextDefault } : repoConfig;
        })
      }
      onUpdateField={onUpdateSelectedRepoDefaultModel}
      onClear={onClearSelectedRepoDefaultModel}
    />
  );
}
