import type { RuntimeDescriptor, RuntimeKind, SettingsRepoConfig } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type ReactElement, useMemo } from "react";
import type { ModelPickerFavoriteState } from "@/components/features/agents/model-picker";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  filterRuntimeDefinitionsForDefaultSelection,
  findRuntimeDefinition,
  resolveRuntimeKindSelection,
} from "@/lib/agent-runtime";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";
import { ensureDraftAgentDefault } from "./model-defaults-model";
import { buildRepositoryAgentControls } from "./repository-agent-controls";
import { resolveRepoAgentDefaultModelPickerSelection } from "./repository-agent-selection";
import { RepositoryModelPickerField } from "./repository-model-picker-field";

type RepositoryDefaultModelBlockProps = {
  presentation?: "settings" | "creation";
  selectedRepoConfig: Pick<SettingsRepoConfig, "defaultModel" | "agentDefaults">;
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
    updater: (
      current: Pick<SettingsRepoConfig, "defaultModel" | "agentDefaults">,
    ) => Pick<SettingsRepoConfig, "defaultModel" | "agentDefaults">,
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
  const { isLoadingSettings, isSaving } = loadingState;
  const defaultModel = selectedRepoConfig.defaultModel ?? null;
  const runtimeDefinitions = useMemo(
    () => filterRuntimeDefinitionsForDefaultSelection(availableRuntimeDefinitions),
    [availableRuntimeDefinitions],
  );
  const runtimeKind = resolveRuntimeKindSelection({
    runtimeDefinitions,
    requestedRuntimeKind: defaultModel?.runtimeKind ?? null,
  });
  const runtimeDescriptor = runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, runtimeKind)
    : null;
  const catalog = runtimeKind ? getCatalogForRuntime(runtimeKind) : null;
  const isModelPickerCatalogLoading = runtimeKind ? isCatalogLoadingForRuntime(runtimeKind) : false;
  const value = ensureDraftAgentDefault(defaultModel);
  const controls = buildRepositoryAgentControls({
    value,
    runtimeKind,
    runtimeDescriptor,
    catalog,
    isCatalogLoading: isModelPickerCatalogLoading,
    isSaving,
  });
  const isClearDisabled = isLoadingSettings || isSaving || defaultModel === null;
  const isCreation = presentation === "creation";

  return (
    <div
      className={cn(
        "@container grid border border-border bg-card",
        isCreation ? "gap-3 rounded-xl p-4 sm:p-5" : "gap-2 rounded-md p-3",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold text-foreground">Default Model</h3>
          <p className="text-xs text-muted-foreground">
            Used for new chats and for workflow sessions that have no role default.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isClearDisabled}
          onClick={onClearSelectedRepoDefaultModel}
        >
          Clear
        </Button>
      </div>

      <div className="grid gap-3 @2xl:grid-cols-3">
        <RepositoryModelPickerField
          runtimeDefinitions={runtimeDefinitions}
          catalogResources={catalogResources}
          value={controls.selectedPickerValue}
          favoriteState={favoriteState}
          isReadOnly={isSaving || isLoadingSettings}
          isLoadingCatalog={isModelPickerCatalogLoading}
          onSelect={(selectedValue, targetCatalog) => {
            onUpdateSelectedRepoConfig((repoConfig) => {
              const nextDefault = resolveRepoAgentDefaultModelPickerSelection({
                currentValue:
                  repoConfig.defaultModel === undefined
                    ? null
                    : ensureDraftAgentDefault(repoConfig.defaultModel),
                currentRuntimeKind: repoConfig.defaultModel?.runtimeKind ?? null,
                targetCatalog,
                value: selectedValue,
              });
              if (!nextDefault) {
                return repoConfig;
              }
              return {
                ...repoConfig,
                defaultModel: nextDefault,
              };
            });
          }}
        />

        <div className="grid min-w-0 gap-1">
          <Label className="text-xs">Agent Profile</Label>
          <Combobox
            value={value.profileId}
            options={controls.profile.options}
            placeholder={controls.profile.placeholder}
            disabled={controls.profile.disabled}
            className="w-full min-w-0"
            onValueChange={(profileId) => onUpdateSelectedRepoDefaultModel("profileId", profileId)}
          />
        </div>

        <div className="grid min-w-0 gap-1">
          <Label className="text-xs">Effort</Label>
          <Combobox
            value={value.variant}
            options={controls.variant.options}
            placeholder={controls.variant.placeholder}
            disabled={controls.variant.disabled}
            className="w-full min-w-0"
            onValueChange={(variant) => onUpdateSelectedRepoDefaultModel("variant", variant)}
          />
        </div>
      </div>
    </div>
  );
}
