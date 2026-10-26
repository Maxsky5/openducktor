import { afterEach, describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { type BrowserSlot, createBrowserSurfaceRegistry } from "./browser-surface-registry";
import { useBrowserSurfacePlacement } from "./use-browser-surface-placement";

const frames: FrameRequestCallback[] = [];
const realRequestAnimationFrame = globalThis.requestAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = realRequestAnimationFrame;
  frames.length = 0;
});

describe("useBrowserSurfacePlacement", () => {
  test.each(["hidden", "removed"])("reports a %s slot as hidden on every commit", (state) => {
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    const slots = createBrowserSurfaceRegistry<BrowserSlot>();
    const element = document.createElement("div");
    element.getBoundingClientRect = () => DOMRect.fromRect({ width: 800, height: 500 });
    const remove = slots.register("browser:tab-1", { element, visible: true });
    const hiddenCommits: boolean[] = [];
    const { result } = renderHook(() => {
      const placement = useBrowserSurfacePlacement(slots, "browser:tab-1");
      useLayoutEffect(() => {
        if (!slots.get("browser:tab-1")?.visible) hiddenCommits.push(placement.visible);
      });
      return placement;
    });
    expect(result.current.visible).toBe(true);

    act(() => {
      if (state === "removed") remove();
      else slots.register("browser:tab-1", { element, visible: false });
    });

    expect(hiddenCommits).toContain(false);
    expect(hiddenCommits).not.toContain(true);
    expect(result.current).toEqual({ visible: false, left: 0, top: 0, width: 800, height: 500 });
  });

  test("keeps the last page size while the slot has no box, such as in a closed panel", () => {
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    const slots = createBrowserSurfaceRegistry<BrowserSlot>();
    const element = document.createElement("div");
    let box = { left: 10, top: 20, width: 800, height: 500 };
    element.getBoundingClientRect = () => DOMRect.fromRect({ x: box.left, y: box.top, ...box });
    slots.register("browser:tab-1", { element, visible: true });

    const { result } = renderHook(() => useBrowserSurfacePlacement(slots, "browser:tab-1"));
    expect(result.current).toEqual({ visible: true, left: 10, top: 20, width: 800, height: 500 });

    box = { left: 0, top: 0, width: 0, height: 0 };
    act(() => frames.shift()?.(0));

    expect(result.current).toEqual({ visible: false, left: 10, top: 20, width: 800, height: 500 });
  });
});
