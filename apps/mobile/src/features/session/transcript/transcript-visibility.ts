import { useCallback, useSyncExternalStore } from "react";

/**
 * The transcript rows in or near the viewport. Images and isolated pages read it, so they load
 * only when their row comes near the viewport. A row reads one boolean and renders again only
 * when it changes.
 */
export type VisibleRowsStore = {
  setVisible: (keys: Iterable<string>) => void;
  isVisible: (key: string) => boolean;
  subscribe: (listener: () => void) => () => void;
};

export const createVisibleRowsStore = (): VisibleRowsStore => {
  let visible = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    setVisible(keys) {
      const next = new Set(keys);
      if (next.size === visible.size && [...next].every((key) => visible.has(key))) return;
      visible = next;
      for (const listener of Array.from(listeners)) listener();
    },
    isVisible: (key) => visible.has(key),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/**
 * The rows on each side of the rows in view that count as visible. Their images load before they
 * scroll in, and a short scroll away and back does not read them from the host again.
 */
const VISIBLE_ROW_MARGIN = 3;

/**
 * The keys of the rows in view and of `margin` rows on each side, in list order. The indices are
 * the list view tokens, whose index can be null.
 */
export const rowKeysNearViewport = (
  rows: readonly { readonly key: string }[],
  viewableIndices: Iterable<number | null | undefined>,
  margin: number = VISIBLE_ROW_MARGIN,
): string[] => {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const index of viewableIndices) {
    if (index === null || index === undefined) continue;
    first = Math.min(first, index);
    last = Math.max(last, index);
  }
  if (!Number.isFinite(first)) return [];
  return rows
    .slice(Math.max(0, first - margin), Math.min(rows.length, last + margin + 1))
    .map((row) => row.key);
};

export type RowVisibility = {
  readonly subscribe: VisibleRowsStore["subscribe"];
  readonly isVisible: () => boolean;
};

/** The visibility of one row, for a view that reads it only in the parts that need it. */
export const rowVisibility = (store: VisibleRowsStore, key: string): RowVisibility => ({
  subscribe: store.subscribe,
  isVisible: () => store.isVisible(key),
});

/** True while the row is in or near the viewport. */
export const useRowVisible = (store: VisibleRowsStore, key: string): boolean => {
  const read = useCallback(() => store.isVisible(key), [key, store]);
  return useSyncExternalStore(store.subscribe, read, read);
};
