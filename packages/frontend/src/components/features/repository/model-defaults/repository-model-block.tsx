import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type ReactElement, useId } from "react";
import type { ModelPickerFavoriteState } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import {
  findRuntimeDefinition,
  resolveRuntimeKindSelection,
} from "@openducktor/frontend-core/lib/agent-runtime";
import type { RuntimeModelCatalogQueryResource } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import { Button } from "@/components/ui/button";
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

/** A compact card that selects one model of a runtime, its effort, and optionally profile and speed. */
export function RepositoryModelBlock({
  title,
  description,
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
  const titleId = useId();
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
  const pickerOptions = toRepositoryModelPickerOptions({
    controls,
    value,
    optionScope,
    onUpdateField,
  });
  const hasSelection = controls.selectedPickerValue !== null;

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          disabled={isLoadingSettings || isSaving || !hasSelection}
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
    </section>
  );
}
