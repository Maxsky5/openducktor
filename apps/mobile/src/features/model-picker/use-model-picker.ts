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
import { useMemo, useState } from "react";
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
  runtimes,
  selection,
  favorites,
  lock,
}: {
  runtimes: readonly ModelPickerRuntime[];
  selection: AgentModelSelection | null;
  favorites: readonly AgentModelFavorite[] | null;
  lock: ModelPickerLock | null;
}): ModelPicker {
  const [query, setQuery] = useState("");
  const lockedRuntimeKind = lock?.runtimeKind ?? null;
  const singleRuntimeKind = runtimes.length === 1 ? (runtimes[0]?.descriptor.kind ?? null) : null;
  const selectionRuntimeKind = selection?.runtimeKind ?? null;
  const [view, setView] = useState<ModelPickerView>(() =>
    openingModelPickerView({ runtimes, favorites, lock, selectionRuntimeKind }),
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
  return { query, setQuery, searching, view, setView, tabs, shownRuntimes, rows };
}
