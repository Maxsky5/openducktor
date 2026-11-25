import type { AgentModelFavorite, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import {
  type AgentModelAttachmentSupport,
  type AgentModelCatalog,
  type AgentModelSelection,
  findCatalogModel,
  resolveSavedModelAlias,
  STANDARD_SPEED,
} from "@openducktor/core";
import { formatTokenCompact } from "../../lib/format-token-count";
import type { SelectOption } from "../../lib/select-option";
import type {
  ModelPickerFavoriteState,
  ModelPickerItem,
  ModelPickerRuntime,
  ModelPickerSelectionPolicy,
  ModelPickerView,
} from "./model-picker-model";
import type { SpeedControlModel } from "./use-speed-control";

export const SPEED_RESET_TO_STANDARD_NOTICE =
  "Speed was set to Standard because this model does not support the previous level.";

export type ModelSpeedTone = "standard" | "fast" | "ultrafast";

export const speedToneFor = (speed: string | undefined): ModelSpeedTone => {
  if (!speed || speed === STANDARD_SPEED) {
    return "standard";
  }
  return speed.toLowerCase() === "ultrafast" ? "ultrafast" : "fast";
};

/** Returns the active account speed block reason when a non-standard speed is selected. */
export const blockedSpeedReason = (
  speed: Pick<SpeedControlModel, "choice" | "blockedReason"> | null | undefined,
): string | null => {
  if (!speed || speed.choice === STANDARD_SPEED || !speed.blockedReason) {
    return null;
  }
  return speed.blockedReason;
};

export type ModelTriggerSummary = {
  runtime: RuntimeDescriptor | null;
  profileLabel: string | null;
  modelLabel: string;
  effortLabel: string | null;
  speedTone: ModelSpeedTone;
  speedLabel: string | null;
  nonStandardSpeedLabel: string | null;
  ariaLabel: string;
};

const catalogProfileLabelFor = (
  catalog: AgentModelCatalog | null,
  profileId: string,
  profileOptions?: readonly SelectOption[],
): string => {
  const fromOption = profileOptions?.find((option) => option.value === profileId)?.label;
  if (fromOption) {
    return fromOption;
  }
  const fromCatalog = catalog?.profiles?.find(
    (profile) => (profile.id ?? profile.name) === profileId,
  );
  return fromCatalog?.label ?? fromCatalog?.name ?? profileId;
};

/**
 * Resolves the shared trigger summary used by desktop, web, and mobile merged model triggers.
 */
export const resolveModelTriggerSummary = ({
  runtime,
  catalog,
  selection,
  speed,
  profileOptions,
  effortOptions,
  placeholder = "Select a model",
  disabledReason = null,
  supportsProfiles,
  supportsVariants,
  supportsSpeed,
}: {
  runtime: RuntimeDescriptor | null;
  catalog: AgentModelCatalog | null;
  selection: AgentModelSelection | null;
  speed?: Pick<SpeedControlModel, "choice" | "levels"> | null | undefined;
  profileOptions?: readonly SelectOption[] | undefined;
  effortOptions?: readonly SelectOption[] | undefined;
  placeholder?: string;
  disabledReason?: string | null;
  supportsProfiles?: boolean | undefined;
  supportsVariants?: boolean | undefined;
  supportsSpeed?: boolean | undefined;
}): ModelTriggerSummary => {
  const effectiveSupportsProfiles =
    supportsProfiles ?? runtime?.capabilities.optionalSurfaces.supportsProfiles ?? false;
  const effectiveSupportsVariants =
    supportsVariants ?? runtime?.capabilities.optionalSurfaces.supportsVariants ?? true;
  const effectiveSupportsSpeed =
    supportsSpeed ?? (runtime ? runtime.capabilities.speed.support !== "none" : false);

  const catalogModel =
    catalog && selection
      ? findCatalogModel(catalog, resolveSavedModelAlias(catalog, selection))
      : null;
  const modelLabel = catalogModel?.modelName ?? selection?.modelId ?? placeholder;

  const profileId = selection?.profileId?.trim() || undefined;
  const profileLabel =
    effectiveSupportsProfiles && profileId
      ? catalogProfileLabelFor(catalog, profileId, profileOptions)
      : null;

  const variant = selection?.variant?.trim() || undefined;
  const modelAllowsEfforts = !catalogModel || catalogModel.variants.length > 0;
  const effortLabel =
    effectiveSupportsVariants && variant && modelAllowsEfforts
      ? (effortOptions?.find((option) => option.value === variant)?.label ?? variant)
      : null;

  const activeSpeedChoice = speed?.choice ?? selection?.speed ?? STANDARD_SPEED;
  const speedTone = speedToneFor(activeSpeedChoice);
  const speedLevels = speed?.levels ?? catalogModel?.speedLevels ?? [];
  const showsSpeed =
    activeSpeedChoice !== STANDARD_SPEED || (effectiveSupportsSpeed && speedLevels.length > 0);
  const speedLabel = showsSpeed
    ? activeSpeedChoice === STANDARD_SPEED
      ? "Standard"
      : (speedLevels.find((level) => level.id === activeSpeedChoice)?.label ?? activeSpeedChoice)
    : null;
  const nonStandardSpeedLabel = speedTone !== "standard" ? speedLabel : null;

  const detailParts: string[] = [];
  if (runtime) {
    detailParts.push(runtime.label);
  }
  if (profileLabel) {
    detailParts.push(profileLabel);
  }
  detailParts.push(modelLabel);
  if (effortLabel) {
    detailParts.push(`Effort ${effortLabel}`);
  }
  if (speedLabel) {
    detailParts.push(`Speed ${speedLabel}`);
  }
  const baseAriaLabel = `Select model, ${detailParts.join(", ")}`;
  const ariaLabel = disabledReason ? `${baseAriaLabel}. ${disabledReason}` : baseAriaLabel;

  return {
    runtime,
    profileLabel,
    modelLabel,
    effortLabel,
    speedTone,
    speedLabel,
    nonStandardSpeedLabel,
    ariaLabel,
  };
};

/**
 * The view that a picker opens on: favorites when the runtimes have any, else the selected
 * model's runtime when editable, else the first usable runtime.
 */
export const resolveModelPickerActiveView = (
  runtimes: readonly ModelPickerRuntime[],
  favorites: readonly AgentModelFavorite[] | null,
  selectionPolicy: ModelPickerSelectionPolicy,
  selectedRuntimeKind?: RuntimeKind | null,
): ModelPickerView => {
  if (selectionPolicy.kind === "speed_only") {
    return selectionPolicy.runtimeKind;
  }
  const availableFavorites = favorites?.filter((favorite) =>
    runtimes.some(
      (runtime) =>
        runtime.isEnabledForFavorites && runtime.descriptor.kind === favorite.runtimeKind,
    ),
  );
  if (selectionPolicy.kind === "runtime_locked") {
    if (
      availableFavorites?.some((favorite) => favorite.runtimeKind === selectionPolicy.runtimeKind)
    ) {
      return "favorites";
    }
    return selectionPolicy.runtimeKind;
  }
  if (availableFavorites?.length) {
    return "favorites";
  }
  if (
    selectedRuntimeKind &&
    runtimes.some((runtime) => runtime.descriptor.kind === selectedRuntimeKind)
  ) {
    return selectedRuntimeKind;
  }
  return (
    runtimes.find((runtime) => runtime.isEnabledForFavorites)?.descriptor.kind ??
    runtimes[0]?.descriptor.kind ??
    "favorites"
  );
};

/** The attachment kinds that a model row names, in display order. */
export const MODEL_PICKER_CAPABILITIES = [
  {
    key: "image",
    label: "Supports images",
    description: "Accepts image attachments like screenshots and diagrams",
  },
  {
    key: "video",
    label: "Supports videos",
    description: "Accepts video attachments",
  },
  {
    key: "audio",
    label: "Supports audio",
    description: "Accepts audio attachments",
  },
  {
    key: "pdf",
    label: "Supports PDF files",
    description: "Accepts PDF documents as attachments",
  },
] as const satisfies readonly {
  key: keyof AgentModelAttachmentSupport;
  label: string;
  description: string;
}[];

/** The context window and attachment support of a model row, or null when it has neither. */
export const modelPickerMetadataDescription = (item: ModelPickerItem): string | null => {
  const contextWindowLabel = formatTokenCompact(item.model.contextWindow);
  const supportedCapabilities = MODEL_PICKER_CAPABILITIES.filter(
    (capability) => item.model.attachmentSupport?.[capability.key],
  ).map((capability) => capability.label.replace("Supports ", "").toLowerCase());
  const parts: string[] = [];
  if (contextWindowLabel) {
    parts.push(`${contextWindowLabel} token context window`);
  }
  if (supportedCapabilities.length > 0) {
    parts.push(`Supports ${supportedCapabilities.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(". ") : null;
};

/** Why the favorite toggle is unavailable, or null when the user can change favorites. */
export const modelPickerFavoriteDisabledReason = (
  state: ModelPickerFavoriteState,
): string | null => {
  if (state.canMutate) {
    return null;
  }
  if (state.readError) {
    return `Favorites unavailable: ${state.readError}`;
  }
  if (state.isLoading) {
    return "Favorites are loading.";
  }
  if (state.isMutationPending) {
    return "Saving favorite changes.";
  }
  return state.mutationError ?? "Favorites are unavailable.";
};

export function resolveModelPickerPresentation({
  runtimes,
  activeView,
  searchQuery,
  favoriteState,
  lockedRuntimeKind,
}: {
  runtimes: readonly ModelPickerRuntime[];
  activeView: ModelPickerView;
  searchQuery: string;
  favoriteState: Pick<ModelPickerFavoriteState, "isLoading" | "readError">;
  lockedRuntimeKind: RuntimeKind | null;
}) {
  const visibleResources = runtimes.filter((runtime) => {
    if (lockedRuntimeKind && runtime.descriptor.kind !== lockedRuntimeKind) {
      return false;
    }
    if (searchQuery.trim() || activeView === "favorites") {
      return true;
    }
    return runtime.descriptor.kind === activeView;
  });
  const activeRuntime = runtimes.find((runtime) => runtime.descriptor.kind === activeView) ?? null;

  const emptyMessage = (() => {
    if (runtimes.length === 0) {
      return "No agent runtimes are available.";
    }
    if (searchQuery.trim()) {
      return "No models match your search.";
    }
    if (activeView === "favorites") {
      if (favoriteState.isLoading) {
        return "Loading favorites...";
      }
      if (favoriteState.readError) {
        return "Favorites are unavailable until settings load succeeds.";
      }
      return "No favorite models are available here. Use a model row's star to add one.";
    }
    if (activeRuntime && activeRuntime.resource.status !== "ready") {
      return null;
    }
    return `No ${activeRuntime?.descriptor.label ?? "runtime"} models are available.`;
  })();

  return { visibleResources, emptyMessage };
}
