import type { AgentModelFavorite, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelAttachmentSupport } from "@openducktor/core";
import { formatTokenCompact } from "../../lib/format-token-count";
import type {
  ModelPickerFavoriteState,
  ModelPickerItem,
  ModelPickerRuntime,
  ModelPickerSelectionPolicy,
  ModelPickerValue,
  ModelPickerView,
} from "./model-picker-model";

/** The view that a picker opens on: favorites when the runtimes have any, else a runtime. */
export const resolveModelPickerActiveView = (
  runtimes: readonly ModelPickerRuntime[],
  favorites: readonly AgentModelFavorite[] | null,
  selectionPolicy: ModelPickerSelectionPolicy,
): ModelPickerView => {
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
  value,
  placeholder,
  activeView,
  searchQuery,
  favoriteState,
  lockedRuntimeKind,
}: {
  runtimes: readonly ModelPickerRuntime[];
  value: ModelPickerValue | null;
  placeholder: string;
  activeView: ModelPickerView;
  searchQuery: string;
  favoriteState: Pick<ModelPickerFavoriteState, "isLoading" | "readError">;
  lockedRuntimeKind: RuntimeKind | null;
}) {
  const selectedRuntime = runtimes.find(
    (runtime) => runtime.descriptor.kind === value?.runtimeKind,
  );
  const selectedModel = selectedRuntime?.resource.catalog?.models.find(
    (model) => model.providerId === value?.providerId && model.modelId === value?.modelId,
  );
  const triggerRuntime = selectedRuntime?.descriptor ?? null;
  const triggerModelLabel = selectedModel?.modelName ?? value?.modelId ?? placeholder;
  const triggerAriaLabel = triggerRuntime
    ? `Select model, ${triggerRuntime.label}, ${triggerModelLabel}`
    : `Select model, ${triggerModelLabel}`;
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

  return { triggerRuntime, triggerModelLabel, triggerAriaLabel, visibleResources, emptyMessage };
}
