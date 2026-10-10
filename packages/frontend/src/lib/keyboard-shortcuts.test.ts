import { describe, expect, test } from "bun:test";
import { hasPlatformModifier, isPlatformChord, platformKeyLabels } from "./keyboard-shortcuts";

const keys = (overrides: Partial<KeyboardEventInit> = {}) => ({
  key: "k",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("keyboard shortcuts", () => {
  test("uses Cmd on macOS and Ctrl on Windows and Linux", () => {
    expect(hasPlatformModifier(keys({ metaKey: true }), "darwin")).toBe(true);
    expect(hasPlatformModifier(keys({ ctrlKey: true }), "darwin")).toBe(false);
    expect(hasPlatformModifier(keys({ ctrlKey: true }), "win32")).toBe(true);
    expect(hasPlatformModifier(keys({ ctrlKey: true }), "linux")).toBe(true);
    expect(hasPlatformModifier(keys({ metaKey: true }), "linux")).toBe(false);
    expect(hasPlatformModifier(keys({ metaKey: true, ctrlKey: true }), "darwin")).toBe(false);
  });

  test("matches a chord only without Shift or Alt", () => {
    expect(isPlatformChord(keys({ metaKey: true }), "k", "darwin")).toBe(true);
    expect(isPlatformChord(keys({ metaKey: true, key: "K" }), "k", "darwin")).toBe(true);
    expect(isPlatformChord(keys({ metaKey: true, shiftKey: true }), "k", "darwin")).toBe(false);
    expect(isPlatformChord(keys({ ctrlKey: true, altKey: true }), "k", "linux")).toBe(false);
    expect(isPlatformChord(keys({ ctrlKey: true, key: "j" }), "k", "win32")).toBe(false);
  });

  test("names the key caps of the platform", () => {
    expect(platformKeyLabels("darwin")).toEqual({ modifier: "⌘", alt: "⌥" });
    expect(platformKeyLabels("win32")).toEqual({ modifier: "Ctrl", alt: "Alt" });
  });
});
