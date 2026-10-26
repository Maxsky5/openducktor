import { describe, expect, mock, test } from "bun:test";
import {
  createVisibleRowsStore,
  rowKeysNearViewport,
  rowVisibility,
} from "./transcript-visibility";

const rows = Array.from({ length: 20 }, (_, index) => ({ key: `row-${index}` }));

describe("rowKeysNearViewport", () => {
  test("adds the margin rows on each side of the rows in view", () => {
    expect(rowKeysNearViewport(rows, [8, 9, 10], 2)).toEqual([
      "row-6",
      "row-7",
      "row-8",
      "row-9",
      "row-10",
      "row-11",
      "row-12",
    ]);
  });

  test("stops the margin at the ends of the list", () => {
    expect(rowKeysNearViewport(rows, [0, 1], 3)).toEqual(rows.slice(0, 5).map((row) => row.key));
    expect(rowKeysNearViewport(rows, [19], 3)).toEqual(rows.slice(16).map((row) => row.key));
  });

  test("marks no row while no row is in view", () => {
    expect(rowKeysNearViewport(rows, [])).toEqual([]);
    expect(rowKeysNearViewport(rows, [null, undefined])).toEqual([]);
  });
});

describe("rowVisibility", () => {
  test("reads one row and notifies when the visible rows change", () => {
    const store = createVisibleRowsStore();
    const visibility = rowVisibility(store, "row-2");
    const listener = mock(() => {});
    visibility.subscribe(listener);
    store.setVisible(["row-1", "row-2"]);
    expect(visibility.isVisible()).toBe(true);
    store.setVisible(["row-1", "row-2"]);
    expect(listener).toHaveBeenCalledTimes(1);
    store.setVisible(["row-5"]);
    expect(visibility.isVisible()).toBe(false);
  });
});
