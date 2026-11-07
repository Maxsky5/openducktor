import { describe, expect, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { pageIsOccluded, refreshPageOccluders, usePageOccluders } from "./use-page-occluders";

describe("usePageOccluders", () => {
  test("follows host overlays as they open and close", async () => {
    const { result } = renderHook(() => usePageOccluders());
    expect(result.current).toEqual([]);

    const overlay = document.createElement("div");
    overlay.setAttribute("data-page-occluder", "");
    act(() => {
      document.body.append(overlay);
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      overlay.remove();
    });
    await waitFor(() => expect(result.current).toEqual([]));
  });

  test("follows an overlay that moves while it stays open", async () => {
    const { result } = renderHook(() => usePageOccluders());
    const overlay = document.createElement("div");
    overlay.setAttribute("data-page-occluder", "");
    let left = 10;
    overlay.getBoundingClientRect = () =>
      // SAFETY: happy-dom returns zeros for a detached box, so the test supplies the rectangle.
      ({
        left,
        top: 20,
        right: left + 100,
        bottom: 120,
        width: 100,
        height: 100,
        x: left,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    act(() => {
      document.body.append(overlay);
    });
    await waitFor(() => expect(result.current[0]?.left).toBe(10));

    left = 40;
    await waitFor(() => expect(result.current[0]?.left).toBe(40));

    act(() => {
      overlay.remove();
    });
    await waitFor(() => expect(result.current).toEqual([]));
  });

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
