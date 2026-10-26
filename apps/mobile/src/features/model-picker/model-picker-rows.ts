import type { AgentModelFavorite, RuntimeKind } from "@openducktor/contracts";
import {
  isSameModelPickerValue,
  type ModelPickerItem,
  type ModelPickerRuntime,
  type ModelPickerValue,
  type ModelPickerView,
  modelPickerValueKey,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { resolveModelPickerActiveView } from "@openducktor/frontend-core/sessions/model-selection/model-picker-presentation";

/** One button of the runtime switch: Favorites, or one runtime. */
export type ModelPickerTab = {
  view: ModelPickerView;
  label: string;
  /** The runtime of the tab, or null for Favorites. */
  runtimeKind: RuntimeKind | null;
  /** Why the tab cannot open, or null when it can. */
  disabledReason: string | null;
};

export type ModelPickerHeaderRow = {
  type: "header";
  key: string;
  title: string;
  /** The runtime of a runtime group in Favorites, which shows its brand mark. */
  runtimeKind: RuntimeKind | null;
  /** True for the Favorites group at the top of a runtime. */
  favorites: boolean;
};

export type ModelPickerModelRow = {
  type: "model";
  key: string;
  item: ModelPickerItem;
  /** The line under the model name: the model ID, after its provider outside a provider group. */
  detail: string;
  selected: boolean;
};

export type ModelPickerListRow = ModelPickerHeaderRow | ModelPickerModelRow;

/** The runtime that a picker locks the choice to, with the reason for the lock. */
export type ModelPickerLock = { runtimeKind: RuntimeKind; reason: string };

/**
 * The runtime switch, as the desktop rail: Favorites when a runtime has a favorite model, then
 * each runtime. The tab hides while no runtime has a favorite; the star of a model row adds one.
 */
export const modelPickerTabs = (
  runtimes: readonly ModelPickerRuntime[],
  favorites: readonly AgentModelFavorite[] | null,
  lock: ModelPickerLock | null,
): ModelPickerTab[] => {
  const hasFavorites = (favorites ?? []).some((favorite) =>
    runtimes.some(
      (runtime) =>
        runtime.isEnabledForFavorites &&
        runtime.descriptor.kind === favorite.runtimeKind &&
        (lock === null || lock.runtimeKind === favorite.runtimeKind),
    ),
  );
  const runtimeTabs = runtimes.map((runtime) => ({
    view: runtime.descriptor.kind,
    label: runtime.descriptor.label,
    runtimeKind: runtime.descriptor.kind,
    disabledReason:
      runtime.disabledReason ??
      (lock && lock.runtimeKind !== runtime.descriptor.kind ? lock.reason : null),
  }));
  return hasFavorites
    ? [
        { view: "favorites", label: "Favorites", runtimeKind: null, disabledReason: null },
        ...runtimeTabs,
      ]
    : runtimeTabs;
};

type ModelPickerViewInput = {
  runtimes: readonly ModelPickerRuntime[];
  favorites: readonly AgentModelFavorite[] | null;
  lock: ModelPickerLock | null;
  /** The runtime of the selected model, or null. */
  selectionRuntimeKind: RuntimeKind | null;
};

/**
 * The view that the picker opens on, with the desktop rules: Favorites when a runtime has a
 * favorite model, else the runtime of the selection, else the first runtime.
 */
export const openingModelPickerView = ({
  runtimes,
  favorites,
  lock,
  selectionRuntimeKind,
}: ModelPickerViewInput): ModelPickerView => {
  const policy = lock
    ? { kind: "runtime_locked" as const, ...lock }
    : { kind: "editable" as const };
  const resolved = resolveModelPickerActiveView(runtimes, favorites, policy);
  if (resolved === "favorites") return resolved;
  return selectionRuntimeKind &&
    runtimes.some((runtime) => runtime.descriptor.kind === selectionRuntimeKind)
    ? selectionRuntimeKind
    : resolved;
};

/**
 * The view to show now. The Favorites tab hides with the last favorite model, so the picker then
 * shows the runtime that it opens on without favorites. Any other view stays.
 */
export const shownModelPickerView = ({
  view,
  tabs,
  ...input
}: ModelPickerViewInput & {
  view: ModelPickerView;
  tabs: readonly ModelPickerTab[];
}): ModelPickerView => {
  if (view !== "favorites" || tabs.some((tab) => tab.view === "favorites")) return view;
  return openingModelPickerView(input);
};

const modelRow = (
  item: ModelPickerItem,
  selectedValue: ModelPickerValue | null,
  withProvider: boolean,
): ModelPickerModelRow => ({
  type: "model",
  key: modelPickerValueKey(item.value),
  item,
  detail: withProvider ? `${item.model.providerName} · ${item.model.modelId}` : item.model.modelId,
  selected: isSameModelPickerValue(item.value, selectedValue),
});

const header = (
  key: string,
  title: string,
  runtimeKind: RuntimeKind | null,
  favorites: boolean,
): ModelPickerHeaderRow => ({
  type: "header",
  key: `header:${key}`,
  title,
  runtimeKind,
  favorites,
});

/** Groups items by a key, in the order of the first item of each group. */
const groupBy = (
  items: readonly ModelPickerItem[],
  keyOf: (item: ModelPickerItem) => string,
): ModelPickerItem[][] => {
  const groups = new Map<string, ModelPickerItem[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
};

/**
 * The rows of the model list. A search lists the best matches of all runtimes without groups.
 * Favorites groups the models by runtime. A runtime lists its favorite models first, then its
 * other models by provider. Each model shows once.
 */
export const buildModelPickerRows = ({
  items,
  view,
  searching,
  selectedValue,
}: {
  /** The items of `buildModelPickerItems`, in their order. */
  items: readonly ModelPickerItem[];
  view: ModelPickerView;
  searching: boolean;
  selectedValue: ModelPickerValue | null;
}): ModelPickerListRow[] => {
  if (searching) return items.map((item) => modelRow(item, selectedValue, true));
  if (view === "favorites") {
    return groupBy(items, (item) => item.runtime.kind).flatMap((group) => {
      const runtime = group[0]?.runtime;
      if (!runtime) return [];
      return [
        header(`runtime:${runtime.kind}`, runtime.label, runtime.kind, false),
        ...group.map((item) => modelRow(item, selectedValue, true)),
      ];
    });
  }
  const favorites = items.filter((item) => item.isFavorite);
  const others = items.filter((item) => !item.isFavorite);
  const rows: ModelPickerListRow[] =
    favorites.length > 0
      ? [
          header("favorites", "Favorites", null, true),
          ...favorites.map((item) => modelRow(item, selectedValue, true)),
        ]
      : [];
  for (const group of groupBy(others, (item) => item.model.providerId)) {
    const first = group[0];
    if (!first) continue;
    rows.push(header(`provider:${first.model.providerId}`, first.model.providerName, null, false));
    for (const item of group) rows.push(modelRow(item, selectedValue, false));
  }
  return rows;
};

/** The index of the selected model row, or null when the list does not show it. */
export const selectedModelRowIndex = (rows: readonly ModelPickerListRow[]): number | null => {
  const index = rows.findIndex((row) => row.type === "model" && row.selected);
  return index < 0 ? null : index;
};
