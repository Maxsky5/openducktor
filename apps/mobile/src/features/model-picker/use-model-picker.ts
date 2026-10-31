import type { AgentModelFavorite, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { resolveSavedModelAlias } from "@openducktor/frontend-core/lib/model-catalog-selection";
import {
  buildModelPickerItems,
  type ModelPickerRuntime,
  type ModelPickerValue,
  type ModelPickerView,
  selectableModelPickerCatalog,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { useCallback, useMemo, useState } from "react";
import {
  buildModelPickerRows,
  type ModelPickerListRow,
  type ModelPickerLock,
  type ModelPickerTab,
  modelPickerTabs,
  openingModelPickerView,
  shownModelPickerView,
} from "./model-picker-rows";

export type ModelPicker = {
  loading: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** True while the list shows search results. */
  searching: boolean;
  view: ModelPickerView;
  setView: (view: ModelPickerView) => void;
  tabs: ModelPickerTab[];
  /** The runtimes that the list shows now, for their loading and failure notices. */
  shownRuntimes: ModelPickerRuntime[];
  rows: ModelPickerListRow[];
};

/** The selection as a picker value, with a saved alias resolved to its catalog model. */
const selectedPickerValue = (
  runtimes: readonly ModelPickerRuntime[],
  selection: AgentModelSelection | null,
  fallbackRuntimeKind: RuntimeKind | null,
): ModelPickerValue | null => {
  // A session selection can omit its runtime. It then belongs to the one runtime of the picker.
  const runtimeKind = selection?.runtimeKind ?? fallbackRuntimeKind;
  if (!selection || !runtimeKind) return null;
  const runtime = runtimes.find((entry) => entry.descriptor.kind === runtimeKind);
  const catalog = selectableModelPickerCatalog(runtime?.resource);
  const resolved = catalog ? resolveSavedModelAlias(catalog, selection) : selection;
  return { runtimeKind, providerId: resolved.providerId, modelId: resolved.modelId };
};

/**
 * The state of a model picker, with the desktop rules: it opens on Favorites when a runtime has a
 * favorite model, else on the runtime of the selection. A search covers every runtime that the
 * picker can choose from.
 */
export function useModelPicker({
  visible,
  runtimes,
  selection,
  favorites,
  lock,
}: {
  visible: boolean;
  runtimes: readonly ModelPickerRuntime[];
  selection: AgentModelSelection | null;
  favorites: readonly AgentModelFavorite[] | null;
  lock: ModelPickerLock | null;
}): ModelPicker {
  const lockedRuntimeKind = lock?.runtimeKind ?? null;
  const singleRuntimeKind = runtimes.length === 1 ? (runtimes[0]?.descriptor.kind ?? null) : null;
  const selectionRuntimeKind = selection?.runtimeKind ?? null;
  const [state, setState] = useState(() => ({
    visible,
    query: "",
    view: openingModelPickerView({ runtimes, favorites, lock, selectionRuntimeKind }),
    prepared: false,
  }));
  // Keep the closing list intact. Only a new opening resets its search and chosen tab.
  if (state.visible !== visible) {
    setState(
      visible
        ? {
            visible,
            query: "",
            prepared: false,
            view: openingModelPickerView({ runtimes, favorites, lock, selectionRuntimeKind }),
          }
        : { ...state, visible },
    );
  }
  const { query, view } = state;
  const setQuery = useCallback(
    (query: string) => setState((current) => ({ ...current, query })),
    [],
  );
  const setView = useCallback(
    (view: ModelPickerView) => setState((current) => ({ ...current, view })),
    [],
  );
  const searching = query.trim().length > 0;
  const tabs = useMemo(
    () => modelPickerTabs(runtimes, favorites, lock),
    [favorites, lock, runtimes],
  );
  // The Favorites tab hides with the last favorite, and the picker then shows a runtime. The state
  // keeps that runtime, so a new favorite does not switch the list back by itself.
  const shownView = shownModelPickerView({
    view,
    tabs,
    runtimes,
    favorites,
    lock,
    selectionRuntimeKind,
  });
  if (shownView !== view) setView(shownView);
  const selectedValue = useMemo(
    () => selectedPickerValue(runtimes, selection, lockedRuntimeKind ?? singleRuntimeKind),
    [lockedRuntimeKind, runtimes, selection, singleRuntimeKind],
  );
  const rows = useMemo(() => {
    const items = buildModelPickerItems({
      runtimes,
      favorites,
      activeView: view,
      searchQuery: query,
      lockedRuntimeKind,
    });
    return buildModelPickerRows({ items, view, searching, selectedValue });
  }, [favorites, lockedRuntimeKind, query, runtimes, searching, selectedValue, view]);
  const shownRuntimes = useMemo(
    () =>
      runtimes.filter((runtime) => {
        if (lockedRuntimeKind && runtime.descriptor.kind !== lockedRuntimeKind) return false;
        return searching || view === "favorites" || runtime.descriptor.kind === view;
      }),
    [lockedRuntimeKind, runtimes, searching, view],
  );
  const choices = lock
    ? runtimes.filter((runtime) => runtime.descriptor.kind === lock.runtimeKind)
    : runtimes;
  const pending =
    choices.length > 0 && choices.every((runtime) => runtime.resource.status === "loading");
  // Once shown, tabs, search, and retries keep the same list frame visible.
  if (visible && !pending && !state.prepared) setState({ ...state, prepared: true });
  return {
    loading: visible && pending && !state.prepared,
    query,
    setQuery,
    searching,
    view,
    setView,
    tabs,
    shownRuntimes,
    rows,
  };
}
