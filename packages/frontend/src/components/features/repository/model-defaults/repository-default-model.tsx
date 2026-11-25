import { useWorkflowSettings } from "@openducktor/frontend-core/queries/workflow-settings";
import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { Sparkles } from "lucide-react";
import { type ReactElement, useMemo } from "react";
import { toast } from "sonner";
import type { ModelPickerFavoriteState } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import {
  matchesRecommendedDefaultModel,
  resolveRecommendedDefaultModel,
} from "@openducktor/frontend-core/sessions/model-selection/recommended-default-model";
import { filterRuntimeDefinitionsForDefaultSelection } from "@openducktor/frontend-core/lib/agent-runtime";
import type { RuntimeModelCatalogQueryResource } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import { Button } from "@/components/ui/button";
import type { WorkspaceModelDefaultsDraft } from "@/types/state-slices";
import type { RepoAgentDefaultField } from "./model-defaults-model";
import { RepositoryModelBlock } from "./repository-model-block";
import { applyPickedModelDraft, REPOSITORY_SPEED_RESET_NOTICE } from "./repository-agent-selection";

type RepositoryDefaultModelBlockProps = {
  presentation?: "settings" | "creation";
  embedded?: boolean;
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
  onUpdateSelectedRepoDefaultModel: (field: RepoAgentDefaultField, value: string) => void;
  onClearSelectedRepoDefaultModel: () => void;
};

export function RepositoryDefaultModelBlock({
  presentation = "settings",
  embedded = false,
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
  const recommended = useMemo(
    () => resolveRecommendedDefaultModel({ runtimeDefinitions, catalogResources }),
    [catalogResources, runtimeDefinitions],
  );
  const hasSelectedDefaultModel = Boolean(
    selectedRepoConfig.defaultModel?.providerId && selectedRepoConfig.defaultModel?.modelId,
  );
  const isRecommendedSelected = matchesRecommendedDefaultModel(
    selectedRepoConfig.defaultModel,
    recommended,
  );
  const recommendedSummary = recommended
    ? [recommended.runtimeLabel, recommended.modelLabel, recommended.effortLabel]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <RepositoryModelBlock
      title="Default model"
      description="Used for new sessions and for task sessions that have no role default."
      presentation={presentation}
      embedded={embedded}
      badge={
        isRecommendedSelected ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-info-border/60 bg-info-surface px-2 py-0.5 text-[11px] font-medium text-info-surface-foreground">
            <Sparkles className="size-3" aria-hidden="true" />
            Recommended
          </span>
        ) : null
      }
      suggestion={
        !hasSelectedDefaultModel && recommended && recommendedSummary ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={loadingState.isLoadingSettings || loadingState.isSaving}
            className="h-6 gap-1.5 rounded-full px-2.5 text-[11px] font-medium"
            onClick={() =>
              onUpdateSelectedRepoConfig((current) => ({
                ...current,
                defaultModel: { ...recommended.selection },
              }))
            }
          >
            <Sparkles className="size-3 text-muted-foreground" aria-hidden="true" />
            Use recommended: {recommendedSummary}
          </Button>
        ) : null
      }
      optionScope="full"
      value={selectedRepoConfig.defaultModel ?? null}
      runtimeDefinitions={runtimeDefinitions}
      catalogResources={catalogResources}
      favoriteState={favoriteState}
      loadingState={loadingState}
      getCatalogForRuntime={getCatalogForRuntime}
      isCatalogLoadingForRuntime={isCatalogLoadingForRuntime}
      onSelectModel={(value, targetCatalog) =>
        applyPickedModelDraft({
          currentConfig: selectedRepoConfig,
          readCurrent: (config) => config.defaultModel,
          resolveRuntimeKind: (config) => config.defaultModel?.runtimeKind ?? null,
          getCatalogForRuntime,
          targetCatalog,
          value,
          applyNext: (config, next) => ({ ...config, defaultModel: next }),
          updateConfig: onUpdateSelectedRepoConfig,
          onSpeedReset: () => toast.info(REPOSITORY_SPEED_RESET_NOTICE),
        })
      }
      onUpdateField={onUpdateSelectedRepoDefaultModel}
      onClear={onClearSelectedRepoDefaultModel}
    />
  );
}
