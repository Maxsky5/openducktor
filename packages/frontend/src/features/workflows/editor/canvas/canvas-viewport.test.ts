import { describe, expect, test } from "bun:test";
import {
  contentBounds,
  MAX_FIT_ZOOM,
  MIN_FIT_ZOOM,
  readableViewport,
  revealViewport,
} from "./canvas-viewport";

const SIZE = { width: 600, height: 800 };
const box = (x: number, y: number) => ({ x, y, width: 240, height: 68 });

describe("canvas viewport", () => {
  test("a small workflow opens at the same zoom as any other that fits, centered", () => {
    const viewport = readableViewport(contentBounds([box(0, 0)]), SIZE);
    expect(viewport.zoom).toBe(MAX_FIT_ZOOM);
    expect(viewport.x + 120 * MAX_FIT_ZOOM).toBe(64 + (600 - 104) / 2);
  });

  test("a tall workflow keeps a readable zoom, opens at its top, and stays centered across", () => {
    const viewport = readableViewport(contentBounds([box(0, 0), box(0, 3000)]), SIZE);
    expect(viewport.zoom).toBe(MIN_FIT_ZOOM);
    expect(viewport.y).toBe(64);
    // The column fits across, so no box is cut at the left or right edge.
    expect(viewport.x + 120 * MIN_FIT_ZOOM).toBe(64 + (600 - 104) / 2);
  });

  test("an empty canvas opens at the full zoom", () => {
    expect(readableViewport(contentBounds([]), SIZE).zoom).toBe(MAX_FIT_ZOOM);
  });
});

describe("reveal viewport", () => {
  const start = { x: 0, y: 0, zoom: 1 };

  test("a selection in view keeps the viewport", () => {
    expect(revealViewport(start, SIZE, box(100, 100), box(100, 100))).toEqual(start);
  });

  test("a selection below the view pans up by the smallest step, with its neighbours", () => {
    const neighbours = { x: 100, y: 700, width: 240, height: 268 };
    const next = revealViewport(start, SIZE, box(100, 900), neighbours);
    // The neighbours fit, so their bottom edge lands 48px above the canvas bottom.
    expect(next.y).toBe(800 - 48 - 968);
    expect(next.x).toBe(0);
  });
});
