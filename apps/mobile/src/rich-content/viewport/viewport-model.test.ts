import { describe, expect, test } from "bun:test";
import { createViewportStore, isNearViewport } from "./viewport-model";

describe("isNearViewport", () => {
  const bounds = { top: 100, bottom: 900 };

  test("keeps views within one viewport height of the visible area", () => {
    expect(isNearViewport(500, 200, bounds)).toBe(true);
    // One screen below and one screen above still count, so resources load before they show.
    expect(isNearViewport(1_650, 100, bounds)).toBe(true);
    expect(isNearViewport(-900, 300, bounds)).toBe(true);
  });

  test("releases views more than one viewport height away", () => {
    expect(isNearViewport(1_701, 100, bounds)).toBe(false);
    expect(isNearViewport(-1_000, 299, bounds)).toBe(false);
  });

  test("keeps a block taller than the viewport while any part is near", () => {
    expect(isNearViewport(-5_000, 6_000, bounds)).toBe(true);
  });
});

describe("createViewportStore", () => {
  test("notifies on scroll and on changed bounds only", () => {
    const store = createViewportStore();
    let calls = 0;
    const stop = store.subscribe(() => {
      calls += 1;
    });
    expect(store.bounds()).toBeNull();
    store.setBounds({ top: 0, bottom: 800 });
    store.setBounds({ top: 0, bottom: 800 });
    store.notify();
    expect(store.bounds()).toEqual({ top: 0, bottom: 800 });
    expect(calls).toBe(2);
    stop();
    store.notify();
    expect(calls).toBe(2);
  });
});
