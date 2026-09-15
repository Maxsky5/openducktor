import type { RuntimeDescriptor, RuntimeKind, SettingsRepoConfig } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ReactElement } from "react";
import type { ModelPickerFavoriteState } from "@/components/features/agents/model-picker";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";
import { buildRepositoryAgentControls } from "./settings-repository-agent-controls";
import { RepositoryDefaultModelBlock } from "./settings-repository-default-model";
import { resolveRepoAgentDefaultModelPickerSelection } from "./settings-repository-agent-selection";
import { RepositoryModelPickerField } from "./settings-repository-model-picker-field";
import {
  ensureDraftAgentDefault,
  ROLE_DEFAULTS,
  resolveRepoAgentDefaultRuntimeKind,
} from "./settings-modal-model";

type RepositoryAgentsSectionProps = {
  selectedRepoConfig: SettingsRepoConfig | null;
  availableRuntimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
  favoriteState: ModelPickerFavoriteState;
  loadingState: {
    isLoadingRuntimeDefinitions: boolean;
    isLoadingCatalog: boolean;
    isLoadingSettings: boolean;
    isSaving: boolean;
  };
  runtimeDefinitionsError: string | null;
  runtimeAvailabilityErrors: string[];
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
  onUpdateSelectedRepoAgentDefault: (
    role: "spec" | "planner" | "build" | "qa",
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
    value: string,
  ) => void;
  onClearSelectedRepoAgentDefault: (role: "spec" | "planner" | "build" | "qa") => void;
  onUpdateSelectedRepoDefaultModel: (
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
    value: string,
  ) => void;
  onClearSelectedRepoDefaultModel: () => void;
};

type RepositoryAgentRoleViewModel = {
  runtimeKind: RuntimeKind | null;
  value: ReturnType<typeof ensureDraftAgentDefault>;
  runtimeDescriptor: RuntimeDescriptor | null;
  catalog: AgentModelCatalog | null;
  isCatalogLoading: boolean;
};

const buildRepositoryAgentRoleViewModel = ({
  selectedRepoConfig,
  runtimeDefinitions,
  role,
  getCatalogForRuntime,
  isCatalogLoadingForRuntime,
}: {
  selectedRepoConfig: SettingsRepoConfig;
  runtimeDefinitions: RuntimeDescriptor[];
  role: "spec" | "planner" | "build" | "qa";
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
}): RepositoryAgentRoleViewModel => {
  const value = ensureDraftAgentDefault(selectedRepoConfig.agentDefaults[role] ?? null);
  const runtimeKind = resolveRepoAgentDefaultRuntimeKind({
    selectedRepoConfig,
    runtimeDefinitions,
    role,
  });
  const runtimeDescriptor = runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, runtimeKind)
    : null;
  const catalog = runtimeKind ? getCatalogForRuntime(runtimeKind) : null;

  return {
    runtimeKind,
    value,
    runtimeDescriptor,
    catalog,
    isCatalogLoading: runtimeKind ? isCatalogLoadingForRuntime(runtimeKind) : false,
  };
};

const findMissingRoleLabels = ({
  selectedRepoConfig,
  runtimeDefinitions,
}: {
  selectedRepoConfig: SettingsRepoConfig;
  runtimeDefinitions: RuntimeDescriptor[];
}): string[] =>
  ROLE_DEFAULTS.reduce<string[]>((labels, { role, label }) => {
    const value = selectedRepoConfig.agentDefaults[role];
    const runtimeKind = resolveRepoAgentDefaultRuntimeKind({
      selectedRepoConfig,
      runtimeDefinitions,
      role,
    });
    const runtimeDefinition = runtimeKind
      ? findRuntimeDefinition(runtimeDefinitions, runtimeKind)
      : null;
    const hasCompleteDefault = Boolean(
      value &&
      runtimeDefinition &&
      value.providerId.trim().length > 0 &&
      value.modelId.trim().length > 0 &&
      (!runtimeDefinition.capabilities.optionalSurfaces.supportsProfiles ||
        (value.profileId?.trim().length ?? 0) > 0),
    );

    if (!hasCompleteDefault) {
      labels.push(label);
    }

    return labels;
  }, []);

export function RepositoryAgentsSection({
  selectedRepoConfig,
  availableRuntimeDefinitions,
  catalogResources,
  favoriteState,
  loadingState,
  runtimeDefinitionsError,
  runtimeAvailabilityErrors,
  getCatalogForRuntime,
  isCatalogLoadingForRuntime,
  onUpdateSelectedRepoConfig,
  onUpdateSelectedRepoAgentDefault,
  onClearSelectedRepoAgentDefault,
  onUpdateSelectedRepoDefaultModel,
  onClearSelectedRepoDefaultModel,
}: RepositoryAgentsSectionProps): ReactElement {
  const { isLoadingRuntimeDefinitions, isLoadingCatalog, isLoadingSettings, isSaving } =
    loadingState;
  if (!selectedRepoConfig) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
        Select a repository to edit agent defaults.
      </div>
    );
  }

  const agentDropdownClassName = "sm:min-w-[18rem]";
  const variantDropdownClassName = "sm:min-w-[16rem]";
  const missingRoleLabels = findMissingRoleLabels({
    selectedRepoConfig,
    runtimeDefinitions: availableRuntimeDefinitions,
  });

  return (
    <div className="grid gap-4 p-4">
      <RepositoryDefaultModelBlock
        selectedRepoConfig={selectedRepoConfig}
        availableRuntimeDefinitions={availableRuntimeDefinitions}
        catalogResources={catalogResources}
        favoriteState={favoriteState}
        loadingState={{ isLoadingCatalog, isLoadingSettings, isSaving }}
        getCatalogForRuntime={getCatalogForRuntime}
        isCatalogLoadingForRuntime={isCatalogLoadingForRuntime}
        onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
        onUpdateSelectedRepoDefaultModel={onUpdateSelectedRepoDefaultModel}
        onClearSelectedRepoDefaultModel={onClearSelectedRepoDefaultModel}
      />

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Agent Defaults (Per Role)</h3>
        <p className="text-xs text-muted-foreground">
          Defaults are applied when starting sessions in this repository.
        </p>
      </div>

      {isLoadingCatalog ? (
        <p className="text-xs text-muted-foreground">Loading available agents and models…</p>
      ) : null}
      {isLoadingRuntimeDefinitions ? (
        <p className="text-xs text-muted-foreground">Loading available runtimes…</p>
      ) : null}
      {runtimeDefinitionsError ? (
        <p className="text-xs text-warning-muted">
          Failed to load runtime definitions: {runtimeDefinitionsError}
        </p>
      ) : null}
      {runtimeAvailabilityErrors.length > 0 ? (
        <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-xs text-warning-surface-foreground">
          {runtimeAvailabilityErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}
      {missingRoleLabels.length > 0 ? (
        <p className="text-xs text-warning-muted">
          Missing complete defaults for: {missingRoleLabels.join(", ")}.
        </p>
      ) : null}

      <div className="grid gap-3">
        {ROLE_DEFAULTS.map(({ role, label }) => {
          const roleViewModel = buildRepositoryAgentRoleViewModel({
            selectedRepoConfig,
            runtimeDefinitions: availableRuntimeDefinitions,
            role,
            getCatalogForRuntime,
            isCatalogLoadingForRuntime,
          });
          const { value, isCatalogLoading: isRoleCatalogLoading } = roleViewModel;
          const controls = buildRepositoryAgentControls({ ...roleViewModel, isSaving });

          return (
            <div key={role} className="grid gap-2 rounded-md border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isLoadingSettings || isSaving}
                  onClick={() => onClearSelectedRepoAgentDefault(role)}
                >
                  Clear
                </Button>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <RepositoryModelPickerField
                  runtimeDefinitions={availableRuntimeDefinitions}
                  catalogResources={catalogResources}
                  value={controls.selectedPickerValue}
                  favoriteState={favoriteState}
                  isReadOnly={isSaving || isLoadingSettings}
                  isLoadingCatalog={isRoleCatalogLoading}
                  onSelect={(selectedValue, targetCatalog) => {
                    onUpdateSelectedRepoConfig((repoConfig) => {
                      const currentValue = repoConfig.agentDefaults[role] ?? null;
                      const currentRuntimeKind = resolveRepoAgentDefaultRuntimeKind({
                        selectedRepoConfig: repoConfig,
                        runtimeDefinitions: availableRuntimeDefinitions,
                        role,
                      });
                      const nextDefault = resolveRepoAgentDefaultModelPickerSelection({
                        currentValue: currentValue ? ensureDraftAgentDefault(currentValue) : null,
                        currentRuntimeKind,
                        targetCatalog,
                        value: selectedValue,
                      });
                      if (!nextDefault) {
                        return repoConfig;
                      }
                      return {
                        ...repoConfig,
                        agentDefaults: {
                          ...repoConfig.agentDefaults,
                          [role]: nextDefault,
                        },
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
                    className={agentDropdownClassName}
                    onValueChange={(profileId) =>
                      onUpdateSelectedRepoAgentDefault(role, "profileId", profileId)
                    }
                  />
                </div>

                {controls.variant.visible ? (
                  <div className="grid min-w-0 gap-1">
                    <Label className="text-xs">Variant</Label>
                    <Combobox
                      value={value.variant}
                      options={controls.variant.options}
                      placeholder={controls.variant.placeholder}
                      disabled={controls.variant.disabled}
                      className={variantDropdownClassName}
                      onValueChange={(variant) =>
                        onUpdateSelectedRepoAgentDefault(role, "variant", variant)
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
