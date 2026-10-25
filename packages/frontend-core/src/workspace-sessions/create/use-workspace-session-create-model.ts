import { type AgentModelSelection, coerceVisibleSelectionToCatalog } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import { useRuntimeAvailabilityContext } from "../../app-state/app-state-contexts";
import { useRefreshStaleRuntimeCatalog } from "../../queries/use-runtime-catalog-query";
import { useRuntimeModelCatalogs } from "../../queries/use-runtime-model-catalogs";
import {
  type ModelPickerRuntime,
  type ModelPickerValue,
  modelPickerResourceFromCatalogQuery,
  selectableModelPickerCatalog,
} from "../../sessions/model-selection/model-picker-model";
import { resolveModelSelectionOptions } from "../../sessions/model-selection/model-selection-options";
import { useModelSelectionActions } from "../../sessions/model-selection/use-model-selection-actions";
import { useSpeedControl } from "../../sessions/model-selection/use-speed-control";

const rejectSessionUpdate = (): never => {
  throw new Error("A new chat has no session yet.");
};

/**
 * The model of a new workspace session: the repository Default Model, checked against its runtime
 * catalog, or the model that the user chose, with its effort, speed, and runtime profile. A new
 * session can use each available runtime.
 */
export function useWorkspaceSessionCreateModel(
  repoPath: string,
  defaultSelection: AgentModelSelection | null,
) {
  const { availableRuntimeDefinitions, loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const runtimeKinds = useMemo(
    () => availableRuntimeDefinitions.map((definition) => definition.kind),
    [availableRuntimeDefinitions],
  );
  const { resources } = useRuntimeModelCatalogs({
    repoPath,
    runtimeKinds,
    enabledRuntimeKinds: runtimeKinds,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
  });
  const [draftSelection, setDraftSelection] = useState<AgentModelSelection | null>(null);
  const defaultCatalog = defaultSelection
    ? (resources.find((entry) => entry.runtimeKind === defaultSelection.runtimeKind)?.catalog ??
      null)
    : null;
  const catalogDefault = useMemo(
    () =>
      defaultSelection && defaultCatalog
        ? coerceVisibleSelectionToCatalog(defaultCatalog, defaultSelection)
        : null,
    [defaultCatalog, defaultSelection],
  );
  const selection = draftSelection ?? catalogDefault;
  const runtimeKind = selection?.runtimeKind ?? null;
  const catalog = resources.find((entry) => entry.runtimeKind === runtimeKind)?.catalog ?? null;
  const runtimes = useMemo(
    () =>
      availableRuntimeDefinitions.map((descriptor): ModelPickerRuntime => ({
        descriptor,
        isEnabledForFavorites: true,
        resource: modelPickerResourceFromCatalogQuery(
          resources.find((entry) => entry.runtimeKind === descriptor.kind),
          "Runtime catalog is unavailable.",
        ),
      })),
    [availableRuntimeDefinitions, resources],
  );
  const options = useMemo(
    () =>
      resolveModelSelectionOptions({
        liveSession: false,
        selectionCatalog: catalog,
        selectedModelSelection: selection,
      }),
    [catalog, selection],
  );
  const actions = useModelSelectionActions({
    loadedSessionIdentity: null,
    updateAgentSessionModel: rejectSessionUpdate,
    applyDraftSelection: setDraftSelection,
    selectedModelSelection: selection,
    selectionCatalog: catalog,
    selectedRuntimeKind: runtimeKind,
  });
  const { handleSelectModelPair, handleSelectSpeed } = actions;
  const speed = useSpeedControl({
    key: repoPath,
    runtimeKind,
    catalog,
    selection,
    disabled: false,
    onSelect: handleSelectSpeed,
  });
  const selectModel = useCallback(
    (value: ModelPickerValue) => {
      const runtime = runtimes.find((entry) => entry.descriptor.kind === value.runtimeKind);
      const target = selectableModelPickerCatalog(runtime?.resource);
      if (target) handleSelectModelPair(value, target);
    },
    [handleSelectModelPair, runtimes],
  );
  const refreshRuntimeCatalog = useRefreshStaleRuntimeCatalog(loadRepoRuntimeCatalog);
  // An open model picker reads the stale catalogs that it can show again.
  const onCatalogSelectorOpen = useCallback(() => {
    const kinds = selection?.runtimeKind ? [selection.runtimeKind] : runtimeKinds;
    for (const kind of kinds) {
      refreshRuntimeCatalog({ repoPath, runtimeKind: kind, workingDirectory: repoPath });
    }
  }, [refreshRuntimeCatalog, repoPath, runtimeKinds, selection?.runtimeKind]);
  return {
    selection,
    catalog,
    runtimeKind,
    /** The runtimes that a new session can use. */
    runtimeKinds,
    /** The model catalog read of each runtime that a new session can use. */
    resources,
    runtimes,
    supportsProfiles:
      availableRuntimeDefinitions.find((entry) => entry.kind === runtimeKind)?.capabilities
        .optionalSurfaces.supportsProfiles ?? false,
    isLoading: resources.some((entry) => entry.isLoading),
    ...options,
    ...actions,
    speed,
    selectModel,
    onCatalogSelectorOpen,
    /** True after the user changed the model, its effort, its speed, or its runtime profile. */
    changed: draftSelection !== null,
  };
}
