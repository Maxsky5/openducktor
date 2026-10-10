import type { RuntimeKind } from "@openducktor/contracts";
import type { ModelPickerFavoriteState } from "./model-picker";
import type { ModelPickerRuntime, ModelPickerValue, ModelPickerView } from "./model-picker-model";

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
