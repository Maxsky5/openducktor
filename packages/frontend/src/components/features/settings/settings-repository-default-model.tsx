import type { RuntimeDescriptor, RuntimeKind, SettingsRepoConfig } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type ReactElement, useMemo } from "react";
import { toPrimaryAgentOptions } from "@/components/features/agents";
import {
  type ModelPickerFavoriteState,
  type ModelPickerValue,
} from "@/components/features/agents/model-picker";
import {
  ensureDraftAgentDefault,
  selectedModelKey,
  toVariantOptionsForModelKey,
} from "@/components/features/settings";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  filterRuntimeDefinitionsForDefaultSelection,
  findRuntimeDefinition,
  resolveRuntimeKindSelection,
} from "@/lib/agent-runtime";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";
import { resolveRepoAgentDefaultModelPickerSelection } from "./settings-repository-agent-selection";
import {
  RepositoryModelPickerField,
  toModelPickerRuntimes,
} from "./settings-repository-model-picker-field";

type RepositoryDefaultModelBlockProps = {
  selectedRepoConfig: SettingsRepoConfig;
  availableRuntimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
  favoriteState: ModelPickerFavoriteState;
  loadingState: {
    isLoadingCatalog: boolean;
    isLoadingSettings: boolean;
    isSaving: boolean;
  };
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
  onUpdateSelectedRepoDefaultModel: (
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
    value: string,
  ) => void;
  onClearSelectedRepoDefaultModel: () => void;
};

export function RepositoryDefaultModelBlock({
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
  const { isLoadingCatalog, isLoadingSettings, isSaving } = loadingState;
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
  const modelPickerRuntimes = useMemo(
    () => toModelPickerRuntimes({ runtimeDefinitions, catalogResources }),
    [catalogResources, runtimeDefinitions],
  );
  const selectedPickerValue: ModelPickerValue | null =
    runtimeKind && value.providerId && value.modelId
      ? {
          runtimeKind,
          providerId: value.providerId,
          modelId: value.modelId,
        }
      : null;
  const profileOptions = toPrimaryAgentOptions(catalog);
  const variantOptions = toVariantOptionsForModelKey(catalog, selectedModelKey(value));
  const supportsProfiles =
    runtimeDescriptor?.capabilities.optionalSurfaces.supportsProfiles === true;
  const supportsVariants =
    runtimeDescriptor?.capabilities.optionalSurfaces.supportsVariants === true;
  const isClearDisabled = isLoadingSettings || isSaving || defaultModel === null;

  return (
    <div className="grid gap-2 rounded-md border border-border bg-card p-3">
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

      {isLoadingCatalog ? (
        <p className="text-xs text-muted-foreground">Loading available agents and models…</p>
      ) : null}

      <div className="grid gap-2 md:grid-cols-3">
        <RepositoryModelPickerField
          runtimes={modelPickerRuntimes}
          value={selectedPickerValue}
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

        {supportsProfiles ? (
          <div className="grid min-w-0 gap-1">
            <Label className="text-xs">Agent Profile</Label>
            <Combobox
              value={value.profileId}
              options={profileOptions}
              placeholder={isModelPickerCatalogLoading ? "Loading agents…" : "Select agent"}
              disabled={isModelPickerCatalogLoading || isSaving || profileOptions.length === 0}
              className="sm:min-w-[18rem]"
              onValueChange={(profileId) =>
                onUpdateSelectedRepoDefaultModel("profileId", profileId)
              }
            />
          </div>
        ) : null}

        {supportsVariants ? (
          <div className="grid min-w-0 gap-1">
            <Label className="text-xs">Effort</Label>
            <Combobox
              value={value.variant}
              options={variantOptions}
              placeholder={variantOptions.length > 0 ? "Select variant" : "No variants for model"}
              disabled={
                isModelPickerCatalogLoading ||
                isSaving ||
                !selectedPickerValue ||
                variantOptions.length === 0
              }
              className="sm:min-w-[16rem]"
              onValueChange={(variant) => onUpdateSelectedRepoDefaultModel("variant", variant)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
