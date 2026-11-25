import { describe, expect, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { withAnimationFrameTestDriver } from "@openducktor/frontend-core/test-support/animation-frame-test-driver";
import { pageIsOccluded, refreshPageOccluders, usePageOccluders } from "./use-page-occluders";

describe("usePageOccluders", () => {
  test("follows a host overlay as it opens, moves, and closes", () =>
    withAnimationFrameTestDriver(async (frames) => {
      const { result, unmount } = renderHook(() => usePageOccluders());
      const overlay = document.createElement("div");
      overlay.setAttribute("data-page-occluder", "");
      let left = 10;
      overlay.getBoundingClientRect = () => new DOMRect(left, 20, 100, 100);
      try {
        expect(result.current).toEqual([]);
        await act(async () => document.body.append(overlay));
        expect(result.current[0]?.left).toBe(10);

        left = 40;
        await frames.flushFrame();
        expect(result.current[0]?.left).toBe(40);

        await act(async () => overlay.remove());
        expect(result.current).toEqual([]);
      } finally {
        unmount();
        overlay.remove();
      }
    }));

  test("ignores an overlay that a hidden ancestor hides, and reads it again when it shows", async () => {
    const { result } = renderHook(() => usePageOccluders());
    const surface = document.createElement("div");
    const overlay = document.createElement("div");
    overlay.setAttribute("data-page-occluder", "");
    surface.append(overlay);
    act(() => {
      document.body.append(surface);
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      surface.style.visibility = "hidden";
      refreshPageOccluders();
    });
    await waitFor(() => expect(result.current).toEqual([]));

    act(() => {
      surface.style.visibility = "visible";
      refreshPageOccluders();
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      surface.remove();
    });
    await waitFor(() => expect(result.current).toEqual([]));
  });

  test("ignores document changes that hold no overlay", async () => {
    const { result } = renderHook(() => usePageOccluders());
    const change = document.createElement("div");
    act(() => {
      document.body.append(change);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toEqual([]);
    act(() => {
      change.remove();
    });
  });

  test("tells whether an overlay covers a part of the page box", () => {
    const overlay = { left: 100, top: 100, right: 200, bottom: 200 };

    expect(pageIsOccluded([overlay], { left: 150, top: 150, width: 300, height: 300 })).toBe(true);
    expect(pageIsOccluded([overlay], { left: 0, top: 0, width: 100, height: 100 })).toBe(false);
    expect(pageIsOccluded([], { left: 0, top: 0, width: 100, height: 100 })).toBe(false);
  });
});
