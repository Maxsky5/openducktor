import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ReactElement } from "react";
import type { ModelPickerFavoriteState } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import {
  findRuntimeDefinition,
  resolveRuntimeKindSelection,
} from "@openducktor/frontend-core/lib/agent-runtime";
import type { RuntimeModelCatalogQueryResource } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { RepoAgentDefaultDraft } from "@openducktor/frontend-core/lib/repo-agent-defaults";
import type { ModelPickerValue } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { ensureDraftAgentDefault } from "./model-defaults-model";
import { buildRepositoryAgentControls } from "./repository-agent-controls";
import { RepositoryModelPickerField } from "./repository-model-picker-field";

export type RepositoryModelBlockProps = {
  title: string;
  description: string;
  presentation: "settings" | "creation";
  /** Shows the agent profile picker. */
  showProfile: boolean;
  value: RepoAgentDefaultDraft | null;
  runtimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
  favoriteState: ModelPickerFavoriteState;
  loadingState: { isLoadingSettings: boolean; isSaving: boolean };
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  /** Takes the picker choice. Resolve it with `selectPickedModel` against the current draft. */
  onSelectModel: (value: ModelPickerValue, targetCatalog: AgentModelCatalog) => void;
  onUpdateField: (field: "variant" | "profileId", value: string) => void;
  onClear: () => void;
};

/** A card that selects one model of a runtime, its effort, and optionally an agent profile. */
export function RepositoryModelBlock({
  title,
  description,
  presentation,
  showProfile,
  value: model,
  runtimeDefinitions,
  catalogResources,
  favoriteState,
  loadingState: { isLoadingSettings, isSaving },
  getCatalogForRuntime,
  isCatalogLoadingForRuntime,
  onSelectModel,
  onUpdateField,
  onClear,
}: RepositoryModelBlockProps): ReactElement {
  const runtimeKind = resolveRuntimeKindSelection({
    runtimeDefinitions,
    requestedRuntimeKind: model?.runtimeKind ?? null,
  });
  const runtimeDescriptor = runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, runtimeKind)
    : null;
  const isCatalogLoading = runtimeKind ? isCatalogLoadingForRuntime(runtimeKind) : false;
  const value = ensureDraftAgentDefault(model);
  const controls = buildRepositoryAgentControls({
    value,
    runtimeKind,
    runtimeDescriptor,
    catalog: runtimeKind ? getCatalogForRuntime(runtimeKind) : null,
    isCatalogLoading,
    isSaving,
  });
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
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isLoadingSettings || isSaving || model === null}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>

      <div className={cn("grid gap-3", showProfile ? "@2xl:grid-cols-3" : "@2xl:grid-cols-2")}>
        <RepositoryModelPickerField
          runtimeDefinitions={runtimeDefinitions}
          catalogResources={catalogResources}
          value={controls.selectedPickerValue}
          favoriteState={favoriteState}
          isReadOnly={isSaving || isLoadingSettings}
          isLoadingCatalog={isCatalogLoading}
          onSelect={onSelectModel}
        />

        {showProfile ? (
          <div className="grid min-w-0 gap-1">
            <Label className="text-xs">Agent profile</Label>
            <Combobox
              value={value.profileId}
              options={controls.profile.options}
              placeholder={controls.profile.placeholder}
              disabled={controls.profile.disabled}
              className="w-full min-w-0"
              onValueChange={(profileId) => onUpdateField("profileId", profileId)}
            />
          </div>
        ) : null}

        <div className="grid min-w-0 gap-1">
          <Label className="text-xs">Effort</Label>
          <Combobox
            value={value.variant}
            options={controls.variant.options}
            placeholder={controls.variant.placeholder}
            disabled={controls.variant.disabled}
            className="w-full min-w-0"
            onValueChange={(variant) => onUpdateField("variant", variant)}
          />
        </div>
      </div>
    </div>
  );
}
