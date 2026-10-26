import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import {
  findCatalogModel,
  resolveSavedModelAlias,
  STANDARD_SPEED,
} from "@openducktor/frontend-core/lib/model-catalog-selection";
import type { SelectOption } from "@openducktor/frontend-core/lib/select-option";
import {
  type ModelPickerRuntime,
  selectableModelPickerCatalog,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";

export type ModelSummary = {
  /** The runtime of the selection, for its brand mark. */
  runtimeKind: RuntimeKind | null;
  /** The model name, or null when no model is selected. */
  title: string | null;
  /** The runtime and the provider of the model. */
  detail: string | null;
};

/**
 * The selected model as a model trigger shows it: the catalog model name, with its runtime and
 * provider. A model that the catalog does not list shows its saved IDs.
 */
export const modelSummary = (
  runtimes: readonly ModelPickerRuntime[],
  selection: AgentModelSelection | null,
  /** The runtime of a session selection that does not name its runtime. */
  fallbackRuntimeKind: RuntimeKind | null = null,
): ModelSummary => {
  const runtimeKind = selection?.runtimeKind ?? fallbackRuntimeKind;
  if (!selection) return { runtimeKind, title: null, detail: null };
  const runtime = runtimes.find((entry) => entry.descriptor.kind === runtimeKind) ?? null;
  const catalog = selectableModelPickerCatalog(runtime?.resource);
  const entry = catalog
    ? findCatalogModel(catalog, resolveSavedModelAlias(catalog, selection))
    : null;
  const parts: string[] = [];
  if (runtime) parts.push(runtime.descriptor.label);
  // A runtime can also be a provider, such as OpenCode, and its name shows once.
  const provider = entry?.providerName ?? selection.providerId;
  if (provider !== runtime?.descriptor.label) parts.push(provider);
  return { runtimeKind, title: entry?.modelName ?? selection.modelId, detail: parts.join(" · ") };
};

/** The most effort levels that fit as stops of the effort track on a phone. */
const MAX_TRACK_STOPS = 7;

/**
 * How the effort choice shows: a stepped track for a few levels with one chosen, a menu for one
 * level, many levels, or no chosen level, and a quiet placeholder when the model has no level to
 * choose. A live session can list its current effort as a disabled level that the model does not
 * have, and that level alone also shows the placeholder.
 */
export const effortControlKind = (
  options: readonly SelectOption[],
  value: string | null | undefined,
): "track" | "menu" | "none" => {
  if (!options.some((option) => option.disabled !== true)) return "none";
  const chosen = options.some((option) => option.value === value);
  return chosen && options.length > 1 && options.length <= MAX_TRACK_STOPS ? "track" : "menu";
};

/** The text of the effort field while it has no level to choose. */
export const effortPlaceholder = ({
  loading,
  hasModel,
}: {
  /** True while the model catalog loads. */
  loading: boolean;
  hasModel: boolean;
}): string => {
  if (loading) return "Loading models…";
  if (!hasModel) return "Select model first";
  return "Not supported";
};

export type SpeedChoice = {
  value: string;
  label: string;
  description: string | null;
  disabled: boolean;
};

/** The speed choices: Standard and the levels of the selected model, or none to hide speed. */
export const speedChoices = (control: SpeedControlModel | null): SpeedChoice[] => {
  if (!control || (control.levels.length === 0 && control.choice === STANDARD_SPEED)) return [];
  return [{ id: STANDARD_SPEED, label: "Standard", description: undefined }, ...control.levels].map(
    (level) => ({
      value: level.id,
      label: level.label,
      description: level.description ?? null,
      disabled:
        control.disabled || (level.id !== STANDARD_SPEED && control.blockedReason !== undefined),
    }),
  );
};
