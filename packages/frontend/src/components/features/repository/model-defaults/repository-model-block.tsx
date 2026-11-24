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
import { cn } from "@/lib/utils";
import type { RepoAgentDefaultDraft } from "@openducktor/frontend-core/lib/repo-agent-defaults";
import type { ModelPickerValue } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { ensureDraftAgentDefault } from "./model-defaults-model";
import {
  buildRepositoryAgentControls,
  type RepositoryModelOptionScope,
  toRepositoryModelPickerOptions,
} from "./repository-agent-controls";
import { RepositoryModelPickerField } from "./repository-model-picker-field";

export type RepositoryModelBlockProps = {
  title: string;
  description: string;
  presentation: "settings" | "creation";
  /** Whether the picker exposes profile and speed alongside effort, or effort only. */
  optionScope: RepositoryModelOptionScope;
  value: RepoAgentDefaultDraft | null;
  runtimeDefinitions: RuntimeDescriptor[];
  catalogResources: RuntimeModelCatalogQueryResource[];
  favoriteState: ModelPickerFavoriteState;
  loadingState: { isLoadingSettings: boolean; isSaving: boolean };
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  /** Takes the picker choice. Resolve it with `selectPickedModel` against the current draft. */
  onSelectModel: (value: ModelPickerValue, targetCatalog: AgentModelCatalog) => void;
  onUpdateField: (field: "variant" | "profileId" | "speed", value: string) => void;
  onClear: () => void;
};

/** A card that selects one model of a runtime, its effort, and optionally profile and speed. */
export function RepositoryModelBlock({
  title,
  description,
  presentation,
  optionScope,
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
    includeSpeed: optionScope === "full",
    onSelectSpeed: (speed) => onUpdateField("speed", speed),
  });
  const isCreation = presentation === "creation";
  const pickerOptions = toRepositoryModelPickerOptions({
    controls,
    value,
    optionScope,
    onUpdateField,
  });

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

      <RepositoryModelPickerField
        runtimeDefinitions={runtimeDefinitions}
        catalogResources={catalogResources}
        value={controls.selectedPickerValue}
        favoriteState={favoriteState}
        options={pickerOptions}
        isReadOnly={isSaving || isLoadingSettings}
        isLoadingCatalog={isCatalogLoading}
        onSelect={onSelectModel}
      />
    </div>
  );
}
