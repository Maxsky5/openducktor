import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type ReactElement, type ReactNode, useId } from "react";
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
  presentation: "settings" | "creation";
  /** Renders as a borderless row inside a parent grouped card when true. */
  embedded?: boolean;
  /** Optional inline badge shown beside the title (e.g. Recommended). */
  badge?: ReactNode;
  /** Optional inline action shown beneath the description when a quick suggestion is available. */
  suggestion?: ReactNode;
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

/** A compact row that selects one model of a runtime, its effort, and optionally profile and speed. */
export function RepositoryModelBlock({
  title,
  description,
  presentation,
  embedded = false,
  badge,
  suggestion,
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
  let containerClassName = "@container rounded-lg border border-border bg-card px-4 py-3.5";
  if (embedded) {
    containerClassName = "@container px-4 py-3.5";
  } else if (presentation === "creation") {
    containerClassName = "@container rounded-xl border border-border bg-card px-4 py-3.5";
  }

  return (
    <section aria-labelledby={titleId} className={containerClassName}>
      <div className="grid grid-cols-1 gap-2.5 @[34rem]:grid-cols-[minmax(0,1fr)_minmax(19rem,26rem)] @[34rem]:items-center @[34rem]:gap-6">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="text-sm font-semibold text-foreground">
              {title}
            </h3>
            {badge}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          {suggestion ? <div className="pt-0.5">{suggestion}</div> : null}
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 flex-1">
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            disabled={isLoadingSettings || isSaving || !hasSelection}
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
      </div>
    </section>
  );
}
