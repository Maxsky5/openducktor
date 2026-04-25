import type { RepoConfig, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ReactElement } from "react";
import {
  AgentRuntimeCombobox,
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents";
import {
  ensureDraftAgentDefault,
  findCatalogModel,
  ROLE_DEFAULTS,
  resolveRepoAgentDefaultRuntimeKind,
  selectedModelKeyForRole,
  toRoleVariantOptions,
} from "@/components/features/settings";
import { Button } from "@/components/ui/button";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  findRuntimeDefinition,
  resolveRuntimeKindSelection,
  toAgentRuntimeOptions,
} from "@/lib/agent-runtime";

type RepositoryAgentsSectionProps = {
  selectedRepoConfig: RepoConfig | null;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  isLoadingCatalog: boolean;
  isLoadingSettings: boolean;
  isSaving: boolean;
  runtimeDefinitionsError: string | null;
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  getCatalogErrorForRuntime: (runtimeKind: RuntimeKind) => string | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
  onUpdateSelectedRepoAgentDefault: (
    role: "spec" | "planner" | "build" | "qa",
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
    value: string,
  ) => void;
  onClearSelectedRepoAgentDefault: (role: "spec" | "planner" | "build" | "qa") => void;
};

type RepositoryAgentRoleViewModel = {
  runtimeKind: RuntimeKind;
  value: ReturnType<typeof ensureDraftAgentDefault>;
  runtimeDescriptor: RuntimeDescriptor | null;
  catalog: AgentModelCatalog | null;
  catalogError: string | null;
  isCatalogLoading: boolean;
  agentOptions: ReturnType<typeof toPrimaryAgentOptions>;
  modelOptions: ReturnType<typeof toModelOptions>;
  modelGroups: ComboboxGroup[];
  roleVariantOptions: ReturnType<typeof toRoleVariantOptions>;
  modelKey: string;
};

const buildRepositoryAgentRoleViewModel = ({
  selectedRepoConfig,
  runtimeDefinitions,
  role,
  getCatalogForRuntime,
  getCatalogErrorForRuntime,
  isCatalogLoadingForRuntime,
}: {
  selectedRepoConfig: RepoConfig;
  runtimeDefinitions: RuntimeDescriptor[];
  role: "spec" | "planner" | "build" | "qa";
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  getCatalogErrorForRuntime: (runtimeKind: RuntimeKind) => string | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
}): RepositoryAgentRoleViewModel => {
  const value = ensureDraftAgentDefault(selectedRepoConfig.agentDefaults[role] ?? null);
  const runtimeKind = resolveRepoAgentDefaultRuntimeKind({
    selectedRepoConfig,
    runtimeDefinitions,
    role,
  });
  const runtimeDescriptor = findRuntimeDefinition(runtimeDefinitions, runtimeKind);
  const catalog = getCatalogForRuntime(runtimeKind);

  return {
    runtimeKind,
    value,
    runtimeDescriptor,
    catalog,
    catalogError: getCatalogErrorForRuntime(runtimeKind),
    isCatalogLoading: isCatalogLoadingForRuntime(runtimeKind),
    agentOptions: toPrimaryAgentOptions(catalog),
    modelOptions: toModelOptions(catalog),
    modelGroups: toModelGroupsByProvider(catalog) as ComboboxGroup[],
    roleVariantOptions: toRoleVariantOptions(catalog, selectedRepoConfig.agentDefaults, role),
    modelKey: selectedModelKeyForRole(selectedRepoConfig.agentDefaults, role),
  };
};

export function RepositoryAgentsSection({
  selectedRepoConfig,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  isLoadingCatalog,
  isLoadingSettings,
  isSaving,
  runtimeDefinitionsError,
  getCatalogForRuntime,
  getCatalogErrorForRuntime,
  isCatalogLoadingForRuntime,
  onUpdateSelectedRepoConfig,
  onUpdateSelectedRepoAgentDefault,
  onClearSelectedRepoAgentDefault,
}: RepositoryAgentsSectionProps): ReactElement {
  if (!selectedRepoConfig) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
        Select a repository to edit agent defaults.
      </div>
    );
  }

  const runtimeOptions = toAgentRuntimeOptions(runtimeDefinitions);
  const runtimeDropdownClassName = "sm:min-w-[18rem]";
  const agentDropdownClassName = "sm:min-w-[18rem]";
  const modelDropdownClassName = "sm:min-w-[26rem]";
  const variantDropdownClassName = "sm:min-w-[16rem]";
  const selectedDefaultRuntimeKind = resolveRuntimeKindSelection({
    runtimeDefinitions,
    requestedRuntimeKind: selectedRepoConfig.defaultRuntimeKind,
  });
  const missingRoleLabels = ROLE_DEFAULTS.filter(({ role }) => {
    const value = selectedRepoConfig.agentDefaults[role];
    const runtimeKind = resolveRepoAgentDefaultRuntimeKind({
      selectedRepoConfig,
      runtimeDefinitions,
      role,
    });
    const runtimeDefinition = findRuntimeDefinition(runtimeDefinitions, runtimeKind);
    return !(
      value &&
      runtimeDefinition &&
      value.providerId.trim().length > 0 &&
      value.modelId.trim().length > 0 &&
      (!runtimeDefinition?.capabilities.supportsProfiles ||
        (value.profileId?.trim().length ?? 0) > 0)
    );
  }).map(({ label }) => label);

  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Agent Defaults (Per Role)</h3>
        <p className="text-xs text-muted-foreground">
          Defaults are applied when starting sessions in this repository.
        </p>
      </div>

      <div className="grid gap-2 rounded-md border border-border bg-card p-3 md:max-w-sm">
        <div className="grid gap-1">
          <Label className="text-xs">Default Agent Runtime</Label>
          <AgentRuntimeCombobox
            value={selectedDefaultRuntimeKind}
            runtimeOptions={runtimeOptions}
            disabled={isSaving || isLoadingRuntimeDefinitions || runtimeOptions.length === 0}
            className={runtimeDropdownClassName}
            onValueChange={(defaultRuntimeKind) =>
              onUpdateSelectedRepoConfig((repoConfig) => ({
                ...repoConfig,
                defaultRuntimeKind,
              }))
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Used when a role does not define its own runtime.
        </p>
      </div>

      {isLoadingCatalog ? (
        <p className="text-xs text-muted-foreground">Loading available agents and models...</p>
      ) : null}
      {isLoadingRuntimeDefinitions ? (
        <p className="text-xs text-muted-foreground">Loading available runtimes...</p>
      ) : null}
      {runtimeDefinitionsError ? (
        <p className="text-xs text-warning-muted">
          Failed to load runtime definitions: {runtimeDefinitionsError}
        </p>
      ) : null}
      {missingRoleLabels.length > 0 ? (
        <p className="text-xs text-warning-muted">
          Missing complete defaults for: {missingRoleLabels.join(", ")}.
        </p>
      ) : null}

      <div className="grid gap-3">
        {ROLE_DEFAULTS.map(({ role, label }) => {
          const roleRuntimeOptions = runtimeOptions;
          const roleViewModel = buildRepositoryAgentRoleViewModel({
            selectedRepoConfig,
            runtimeDefinitions,
            role,
            getCatalogForRuntime,
            getCatalogErrorForRuntime,
            isCatalogLoadingForRuntime,
          });
          const {
            value,
            runtimeKind,
            runtimeDescriptor,
            catalog,
            catalogError,
            isCatalogLoading: isRoleCatalogLoading,
            agentOptions,
            modelOptions,
            modelGroups,
            roleVariantOptions,
            modelKey,
          } = roleViewModel;

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

              <div className="grid gap-2 md:grid-cols-4">
                <div className="grid min-w-0 gap-1">
                  <Label className="text-xs">Agent Runtime</Label>
                  <AgentRuntimeCombobox
                    value={runtimeKind}
                    runtimeOptions={roleRuntimeOptions}
                    disabled={
                      isSaving || isLoadingRuntimeDefinitions || roleRuntimeOptions.length === 0
                    }
                    className={runtimeDropdownClassName}
                    onValueChange={(runtimeKind) =>
                      onUpdateSelectedRepoConfig((repoConfig) => ({
                        ...repoConfig,
                        agentDefaults: {
                          ...repoConfig.agentDefaults,
                          [role]: {
                            runtimeKind,
                            providerId: "",
                            modelId: "",
                            variant: "",
                            profileId: "",
                          },
                        },
                      }))
                    }
                  />
                </div>

                {runtimeDescriptor?.capabilities.supportsProfiles ? (
                  <div className="grid min-w-0 gap-1">
                    <Label className="text-xs">Agent</Label>
                    <Combobox
                      value={value.profileId}
                      options={agentOptions}
                      placeholder={isRoleCatalogLoading ? "Loading agents..." : "Select agent"}
                      disabled={isRoleCatalogLoading || isSaving || agentOptions.length === 0}
                      className={agentDropdownClassName}
                      onValueChange={(profileId) =>
                        onUpdateSelectedRepoAgentDefault(role, "profileId", profileId)
                      }
                    />
                  </div>
                ) : null}

                <div className="grid min-w-0 gap-1">
                  <Label className="text-xs">Model</Label>
                  <Combobox
                    value={modelKey}
                    options={modelOptions}
                    groups={modelGroups}
                    matchAllSearchTerms
                    placeholder={isRoleCatalogLoading ? "Loading models..." : "Select model"}
                    disabled={isRoleCatalogLoading || isSaving || modelOptions.length === 0}
                    className={modelDropdownClassName}
                    onValueChange={(selectedModelKey) => {
                      const model = findCatalogModel(catalog, selectedModelKey);
                      if (!model) {
                        return;
                      }

                      onUpdateSelectedRepoConfig((repoConfig) => ({
                        ...repoConfig,
                        agentDefaults: {
                          ...repoConfig.agentDefaults,
                          [role]: {
                            ...ensureDraftAgentDefault(repoConfig.agentDefaults[role] ?? null),
                            runtimeKind,
                            providerId: model.providerId,
                            modelId: model.modelId,
                            variant: model.variants[0] ?? "",
                          },
                        },
                      }));
                    }}
                  />
                </div>

                {runtimeDescriptor?.capabilities.supportsVariants ? (
                  <div className="grid min-w-0 gap-1">
                    <Label className="text-xs">Variant</Label>
                    <Combobox
                      value={value.variant}
                      options={roleVariantOptions}
                      placeholder={
                        roleVariantOptions.length > 0 ? "Select variant" : "No variants for model"
                      }
                      disabled={
                        isRoleCatalogLoading ||
                        isSaving ||
                        !modelKey ||
                        roleVariantOptions.length === 0
                      }
                      className={variantDropdownClassName}
                      onValueChange={(variant) =>
                        onUpdateSelectedRepoAgentDefault(role, "variant", variant)
                      }
                    />
                  </div>
                ) : null}
              </div>

              {catalogError ? (
                <p className="text-xs text-warning-muted">
                  Failed to load runtime catalog: {catalogError}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
