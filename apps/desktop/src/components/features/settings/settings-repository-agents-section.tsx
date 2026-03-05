import type { RepoConfig } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ReactElement } from "react";
import {
  ensureAgentDefault,
  findCatalogModel,
  getMissingRequiredRoleLabels,
  ROLE_DEFAULTS,
  selectedModelKeyForRole,
  toRoleVariantOptions,
} from "@/components/features/settings";
import { Button } from "@/components/ui/button";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";

type RepositoryAgentsSectionProps = {
  selectedRepoConfig: RepoConfig | null;
  isLoadingCatalog: boolean;
  isLoadingSettings: boolean;
  isSaving: boolean;
  catalogError: string | null;
  catalog: AgentModelCatalog | null;
  modelOptions: ComboboxOption[];
  agentOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
  onUpdateSelectedRepoAgentDefault: (
    role: "spec" | "planner" | "build" | "qa",
    field: "providerId" | "modelId" | "variant" | "opencodeAgent",
    value: string,
  ) => void;
  onClearSelectedRepoAgentDefault: (role: "spec" | "planner" | "build" | "qa") => void;
};

export function RepositoryAgentsSection({
  selectedRepoConfig,
  isLoadingCatalog,
  isLoadingSettings,
  isSaving,
  catalogError,
  catalog,
  modelOptions,
  agentOptions,
  modelGroups,
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

  const missingRoleLabels = getMissingRequiredRoleLabels(selectedRepoConfig.agentDefaults);

  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Agent Defaults (Per Role)</h3>
        <p className="text-xs text-muted-foreground">
          Defaults are applied when starting sessions in this repository.
        </p>
      </div>

      {isLoadingCatalog ? (
        <p className="text-xs text-muted-foreground">Loading available agents and models...</p>
      ) : null}
      {catalogError ? (
        <p className="text-xs text-warning-muted">
          Failed to load OpenCode catalog: {catalogError}
        </p>
      ) : null}
      {missingRoleLabels.length > 0 ? (
        <p className="text-xs text-warning-muted">
          Missing complete defaults for: {missingRoleLabels.join(", ")}.
        </p>
      ) : null}

      <div className="grid gap-3">
        {ROLE_DEFAULTS.map(({ role, label }) => {
          const value = ensureAgentDefault(selectedRepoConfig.agentDefaults[role] ?? null);
          const roleVariantOptions = toRoleVariantOptions(
            catalog,
            selectedRepoConfig.agentDefaults,
            role,
          );
          const modelKey = selectedModelKeyForRole(selectedRepoConfig.agentDefaults, role);

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

              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="grid min-w-0 gap-1">
                  <Label className="text-xs">Agent</Label>
                  <Combobox
                    value={value.opencodeAgent}
                    options={agentOptions}
                    placeholder={isLoadingCatalog ? "Loading agents..." : "Select agent"}
                    disabled={isLoadingCatalog || isSaving || agentOptions.length === 0}
                    onValueChange={(opencodeAgent) =>
                      onUpdateSelectedRepoAgentDefault(role, "opencodeAgent", opencodeAgent)
                    }
                  />
                </div>

                <div className="grid min-w-0 gap-1">
                  <Label className="text-xs">Model</Label>
                  <Combobox
                    value={modelKey}
                    options={modelOptions}
                    groups={modelGroups}
                    placeholder={isLoadingCatalog ? "Loading models..." : "Select model"}
                    disabled={isLoadingCatalog || isSaving || modelOptions.length === 0}
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
                            ...ensureAgentDefault(repoConfig.agentDefaults[role] ?? null),
                            providerId: model.providerId,
                            modelId: model.modelId,
                            variant: model.variants[0] ?? "",
                          },
                        },
                      }));
                    }}
                  />
                </div>

                <div className="grid min-w-0 gap-1">
                  <Label className="text-xs">Variant</Label>
                  <Combobox
                    value={value.variant}
                    options={roleVariantOptions}
                    placeholder={
                      roleVariantOptions.length > 0 ? "Select variant" : "No variants for model"
                    }
                    disabled={
                      isLoadingCatalog || isSaving || !modelKey || roleVariantOptions.length === 0
                    }
                    onValueChange={(variant) =>
                      onUpdateSelectedRepoAgentDefault(role, "variant", variant)
                    }
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
