import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ReactElement, ReactNode } from "react";
import type { ModelPickerFavoriteState } from "@/components/features/agents/model-picker";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { cn } from "@/lib/utils";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";
import { buildRepositoryAgentControls } from "./repository-agent-controls";
import { resolveRepoAgentDefaultModelPickerSelection } from "./repository-agent-selection";
import { RepositoryDefaultModelBlock } from "./repository-default-model";
import { RepositoryModelPickerField } from "./repository-model-picker-field";
import {
  ensureDraftAgentDefault,
  ROLE_DEFAULTS,
  resolveRepoAgentDefaultRuntimeKind,
  type ModelDefaultsValue,
} from "./model-defaults-model";

export type RepositoryModelDefaultsFieldsProps = {
  presentation?: "settings" | "creation";
  selectedRepoConfig: ModelDefaultsValue;
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
  roleNotice?: ReactNode;
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  onUpdateSelectedRepoConfig: (
    updater: (current: ModelDefaultsValue) => ModelDefaultsValue,
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
  selectedRepoConfig: ModelDefaultsValue;
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

export function RepositoryModelDefaultsFields({
  presentation = "settings",
  selectedRepoConfig,
  availableRuntimeDefinitions,
  catalogResources,
  favoriteState,
  loadingState,
  runtimeDefinitionsError,
  runtimeAvailabilityErrors,
  roleNotice,
  getCatalogForRuntime,
  isCatalogLoadingForRuntime,
  onUpdateSelectedRepoConfig,
  onUpdateSelectedRepoAgentDefault,
  onClearSelectedRepoAgentDefault,
  onUpdateSelectedRepoDefaultModel,
  onClearSelectedRepoDefaultModel,
}: RepositoryModelDefaultsFieldsProps): ReactElement {
  const { isLoadingRuntimeDefinitions, isLoadingCatalog, isLoadingSettings, isSaving } =
    loadingState;
  const isCreation = presentation === "creation";

  const agentDropdownClassName = isCreation ? "w-full min-w-0" : "sm:min-w-[18rem]";
  const variantDropdownClassName = isCreation ? "w-full min-w-0" : "sm:min-w-[16rem]";

  return (
    <div className={cn("grid", isCreation ? "gap-5" : "gap-4 p-4")}>
      <RepositoryDefaultModelBlock
        presentation={presentation}
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
        <h3 className="text-sm font-semibold text-foreground">
          {isCreation ? "Role defaults" : "Agent Defaults (Per Role)"}
        </h3>
        <p className="text-xs text-muted-foreground">
          {isCreation
            ? "Leave a role empty to use the workspace default."
            : "Defaults are applied when starting sessions in this repository."}
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
      {roleNotice}

      <div className={cn("grid gap-3", isCreation && "lg:grid-cols-2")}>
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
            <div
              key={role}
              className={cn(
                "grid border border-border bg-card",
                isCreation ? "gap-3 rounded-xl p-4" : "gap-2 rounded-md p-3",
              )}
            >
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

              <div className={cn("grid gap-2", isCreation ? "sm:grid-cols-2" : "md:grid-cols-3")}>
                <div className={cn("min-w-0", isCreation && "sm:col-span-2")}>
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
                </div>

                <div
                  className={cn(
                    "grid min-w-0 gap-1",
                    isCreation && !controls.variant.visible && "sm:col-span-2",
                  )}
                >
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
