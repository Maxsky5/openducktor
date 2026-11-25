import { useWorkflowSettings } from "@openducktor/frontend-core/queries/workflow-settings";
import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { LoaderCircle } from "lucide-react";
import { type ReactElement, useId } from "react";
import { toast } from "sonner";
import type { ModelPickerFavoriteState } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { Button } from "@/components/ui/button";
import {
  filterRuntimeDefinitionsForRole,
  findRuntimeDefinition,
} from "@openducktor/frontend-core/lib/agent-runtime";
import { cn } from "@/lib/utils";
import type { RuntimeModelCatalogQueryResource } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import type { WorkspaceModelDefaultsDraft } from "@/types/state-slices";
import {
  buildRepositoryAgentControls,
  toRepositoryModelPickerOptions,
} from "./repository-agent-controls";
import { applyPickedModelDraft, REPOSITORY_SPEED_RESET_NOTICE } from "./repository-agent-selection";
import { RepositoryDefaultModelBlock } from "./repository-default-model";
import { RepositoryModelPickerField } from "./repository-model-picker-field";
import { RepositoryNamingModelBlock } from "./repository-naming-model";
import {
  ensureDraftAgentDefault,
  type RepoAgentDefaultField,
  resolveRepoAgentDefaultRuntimeKind,
} from "./model-defaults-model";

export type RepositoryModelDefaultsFieldsProps = {
  presentation?: "settings" | "creation";
  selectedRepoConfig: WorkspaceModelDefaultsDraft;
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
  modelWarnings: string[];
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  onUpdateSelectedRepoConfig: (
    updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft,
  ) => void;
  onUpdateSelectedRepoAgentDefault: (
    role: string,
    field: RepoAgentDefaultField,
    value: string,
  ) => void;
  onClearSelectedRepoAgentDefault: (role: string) => void;
  onUpdateSelectedRepoDefaultModel: (field: RepoAgentDefaultField, value: string) => void;
  onClearSelectedRepoDefaultModel: () => void;
  /** Shows the naming model. Only the settings show it. */
  showNamingModel?: boolean;
};

export function RepositoryModelDefaultsFields({
  presentation = "settings",
  selectedRepoConfig,
  availableRuntimeDefinitions,
  catalogResources,
  favoriteState,
  loadingState,
  runtimeDefinitionsError,
  modelWarnings,
  getCatalogForRuntime,
  isCatalogLoadingForRuntime,
  onUpdateSelectedRepoConfig,
  onUpdateSelectedRepoAgentDefault,
  onClearSelectedRepoAgentDefault,
  onUpdateSelectedRepoDefaultModel,
  onClearSelectedRepoDefaultModel,
  showNamingModel = false,
}: RepositoryModelDefaultsFieldsProps): ReactElement {
  const roleDefaultsHeadingId = useId();
  const { isLoadingRuntimeDefinitions, isLoadingCatalog, isLoadingSettings, isSaving } =
    loadingState;
  const isCreation = presentation === "creation";
  const defaultModel = selectedRepoConfig.defaultModel;
  const hasDefaultModel = Boolean(defaultModel?.providerId && defaultModel?.modelId);
  const workflows = useWorkflowSettings();
  if (!workflows.data || workflows.error) {
    return (
      <p role={workflows.error ? "alert" : "status"}>
        {workflows.error?.message ?? "Loading workflow roles..."}
      </p>
    );
  }

  return (
    <div className={cn("grid gap-4", isCreation ? "" : "p-4")}>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <RepositoryDefaultModelBlock
          presentation={presentation}
          embedded
          selectedRepoConfig={selectedRepoConfig}
          availableRuntimeDefinitions={availableRuntimeDefinitions}
          catalogResources={catalogResources}
          favoriteState={favoriteState}
          loadingState={{ isLoadingSettings, isSaving }}
          getCatalogForRuntime={getCatalogForRuntime}
          isCatalogLoadingForRuntime={isCatalogLoadingForRuntime}
          onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
          onUpdateSelectedRepoDefaultModel={onUpdateSelectedRepoDefaultModel}
          onClearSelectedRepoDefaultModel={onClearSelectedRepoDefaultModel}
        />

        {showNamingModel ? (
          <RepositoryNamingModelBlock
            embedded
            selectedRepoConfig={selectedRepoConfig}
            availableRuntimeDefinitions={availableRuntimeDefinitions}
            catalogResources={catalogResources}
            favoriteState={favoriteState}
            loadingState={{ isLoadingSettings, isSaving }}
            getCatalogForRuntime={getCatalogForRuntime}
            isCatalogLoadingForRuntime={isCatalogLoadingForRuntime}
            onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
          />
        ) : null}
      </div>

      <RepositoryModelDefaultsAlerts
        runtimeDefinitionsError={runtimeDefinitionsError}
        modelWarnings={modelWarnings}
      />

      <section
        aria-labelledby={roleDefaultsHeadingId}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        <RepositoryRoleDefaultsHeader
          headingId={roleDefaultsHeadingId}
          isCreation={isCreation}
          isLoadingRuntimeDefinitions={isLoadingRuntimeDefinitions}
          isLoadingCatalog={isLoadingCatalog}
        />

        <div className="divide-y divide-border">
          {workflows.data.roles.map(({ role, label, definition }) => (
            <RepositoryRoleDefaultRow
              key={role}
              role={role}
              label={label}
              runtimeDefinitions={filterRuntimeDefinitionsForRole(
                availableRuntimeDefinitions,
                definition,
              )}
              selectedRepoConfig={selectedRepoConfig}
              catalogResources={catalogResources}
              favoriteState={favoriteState}
              hasDefaultModel={hasDefaultModel}
              isLoadingSettings={isLoadingSettings}
              isSaving={isSaving}
              getCatalogForRuntime={getCatalogForRuntime}
              isCatalogLoadingForRuntime={isCatalogLoadingForRuntime}
              onUpdateSelectedRepoConfig={onUpdateSelectedRepoConfig}
              onUpdateSelectedRepoAgentDefault={onUpdateSelectedRepoAgentDefault}
              onClearSelectedRepoAgentDefault={onClearSelectedRepoAgentDefault}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function RepositoryModelDefaultsAlerts({
  runtimeDefinitionsError,
  modelWarnings,
}: {
  runtimeDefinitionsError: string | null;
  modelWarnings: string[];
}): ReactElement | null {
  if (!runtimeDefinitionsError && modelWarnings.length === 0) return null;
  return (
    <>
      {runtimeDefinitionsError ? (
        <p className="text-xs text-warning-muted">
          Could not load runtimes: {runtimeDefinitionsError}
        </p>
      ) : null}
      {modelWarnings.length > 0 ? (
        <div className="rounded-lg border border-warning-border bg-warning-surface p-3 text-xs text-warning-surface-foreground">
          {modelWarnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}

function RepositoryRoleDefaultsHeader({
  headingId,
  isCreation,
  isLoadingRuntimeDefinitions,
  isLoadingCatalog,
}: {
  headingId: string;
  isCreation: boolean;
  isLoadingRuntimeDefinitions: boolean;
  isLoadingCatalog: boolean;
}): ReactElement {
  let loadingLabel: string | null = null;
  if (isLoadingRuntimeDefinitions) {
    loadingLabel = "Loading runtimes…";
  } else if (isLoadingCatalog) {
    loadingLabel = "Loading models…";
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {isCreation ? "Role defaults" : "Agent defaults by role"}
        </h3>
        <p className="text-xs text-muted-foreground">
          {isCreation
            ? "Leave a role empty to use the workspace default."
            : "Override the workspace default for specific roles."}
        </p>
      </div>
      {loadingLabel ? (
        <span
          role="status"
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
        >
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          {loadingLabel}
        </span>
      ) : null}
    </div>
  );
}

type RepositoryRoleDefaultRowProps = {
  role: string;
  label: string;
  runtimeDefinitions: RuntimeDescriptor[];
  selectedRepoConfig: WorkspaceModelDefaultsDraft;
  catalogResources: RuntimeModelCatalogQueryResource[];
  favoriteState: ModelPickerFavoriteState;
  hasDefaultModel: boolean;
  isLoadingSettings: boolean;
  isSaving: boolean;
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  onUpdateSelectedRepoConfig: (
    updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft,
  ) => void;
  onUpdateSelectedRepoAgentDefault: (
    role: string,
    field: RepoAgentDefaultField,
    value: string,
  ) => void;
  onClearSelectedRepoAgentDefault: (role: string) => void;
};

function RepositoryRoleDefaultRow({
  role,
  label,
  runtimeDefinitions,
  selectedRepoConfig,
  catalogResources,
  favoriteState,
  hasDefaultModel,
  isLoadingSettings,
  isSaving,
  getCatalogForRuntime,
  isCatalogLoadingForRuntime,
  onUpdateSelectedRepoConfig,
  onUpdateSelectedRepoAgentDefault,
  onClearSelectedRepoAgentDefault,
}: RepositoryRoleDefaultRowProps): ReactElement {
  const roleViewModel = buildRepositoryAgentRoleViewModel({
    selectedRepoConfig,
    runtimeDefinitions,
    role,
    getCatalogForRuntime,
    isCatalogLoadingForRuntime,
  });
  const { value, isCatalogLoading: isRoleCatalogLoading } = roleViewModel;
  const controls = buildRepositoryAgentControls({
    ...roleViewModel,
    isSaving,
    includeSpeed: true,
    onSelectSpeed: (speed) => onUpdateSelectedRepoAgentDefault(role, "speed", speed),
  });
  const hasRoleOverride = controls.selectedPickerValue !== null;
  const rolePlaceholder = hasDefaultModel ? "Use workspace default" : "Select a model";

  return (
    <div aria-label={label} className="@container px-4 py-2.5">
      <div className="grid grid-cols-1 gap-2 @[34rem]:grid-cols-[minmax(0,1fr)_minmax(19rem,26rem)] @[34rem]:items-center @[34rem]:gap-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          {!hasRoleOverride && hasDefaultModel ? (
            <p className="text-[11px] text-muted-foreground">Uses workspace default</p>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <RepositoryModelPickerField
              runtimeDefinitions={runtimeDefinitions}
              catalogResources={catalogResources}
              value={controls.selectedPickerValue}
              favoriteState={favoriteState}
              options={toRepositoryModelPickerOptions({
                controls,
                value,
                optionScope: "full",
                onUpdateField: (field, nextValue) =>
                  onUpdateSelectedRepoAgentDefault(role, field, nextValue),
              })}
              isReadOnly={isSaving || isLoadingSettings}
              isLoadingCatalog={isRoleCatalogLoading}
              placeholder={rolePlaceholder}
              onSelect={(selectedValue, targetCatalog) =>
                applyPickedModelDraft({
                  currentConfig: selectedRepoConfig,
                  readCurrent: (config) => config.agentDefaults[role],
                  resolveRuntimeKind: (config) =>
                    resolveRepoAgentDefaultRuntimeKind({
                      selectedRepoConfig: config,
                      runtimeDefinitions,
                      role,
                    }),
                  getCatalogForRuntime,
                  targetCatalog,
                  value: selectedValue,
                  applyNext: (config, next) => ({
                    ...config,
                    agentDefaults: { ...config.agentDefaults, [role]: next },
                  }),
                  updateConfig: onUpdateSelectedRepoConfig,
                  onSpeedReset: () => toast.info(REPOSITORY_SPEED_RESET_NOTICE),
                })
              }
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            disabled={isLoadingSettings || isSaving || !hasRoleOverride}
            onClick={() => onClearSelectedRepoAgentDefault(role)}
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

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
  selectedRepoConfig: WorkspaceModelDefaultsDraft;
  runtimeDefinitions: RuntimeDescriptor[];
  role: string;
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
