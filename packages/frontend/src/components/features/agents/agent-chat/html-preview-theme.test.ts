import { afterEach, describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useHtmlPreviewTheme } from "./html-preview-theme";

const root = document.documentElement;

afterEach(() => {
  root.classList.remove("dark", "unrelated-class");
  root.style.removeProperty("--chat-background");
  root.style.removeProperty("--background");
});

describe("useHtmlPreviewTheme", () => {
  test("reads the dark transcript surface and falls back to the base background", () => {
    root.classList.add("dark");
    root.style.setProperty("--background", "#111114");
    root.style.setProperty("--chat-background", "#0b0b0f");

    const dark = renderHook(() => useHtmlPreviewTheme());
    expect(dark.result.current.surface).toEqual({
      appearance: "dark",
      background: "#0b0b0f",
    });
    dark.unmount();

    root.classList.remove("dark");
    root.style.removeProperty("--chat-background");
    root.style.setProperty("--background", "#fafafa");

    const light = renderHook(() => useHtmlPreviewTheme());
    expect(light.result.current.surface).toEqual({
      appearance: "light",
      background: "#fafafa",
    });
    light.unmount();
  });

  test("preserves snapshot identity across unrelated root class mutations and updates on theme toggle", async () => {
    const first = renderHook(() => useHtmlPreviewTheme());
    const second = renderHook(() => useHtmlPreviewTheme());
    const initial = first.result.current;
    expect(second.result.current).toBe(initial);

    await act(async () => {
      root.classList.add("unrelated-class");
      await Promise.resolve();
    });
    expect(first.result.current).toBe(initial);
    expect(second.result.current).toBe(initial);

    await act(async () => {
      root.classList.add("dark");
      await Promise.resolve();
    });
    expect(first.result.current.surface.appearance).toBe("dark");
    expect(second.result.current).toBe(first.result.current);

    first.unmount();
    second.unmount();
  });
});
