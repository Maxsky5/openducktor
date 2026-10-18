import { describe, expect, test } from "bun:test";
import { isSteerShortcut, steerShortcutLabel } from "./steer-shortcut";

const enter = (modifiers: Partial<Parameters<typeof isSteerShortcut>[0]> = {}) => ({
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("steer shortcut", () => {
  test("uses Command+Enter on Apple platforms", () => {
    expect(isSteerShortcut(enter({ metaKey: true }), true)).toBe(true);
    expect(isSteerShortcut(enter({ ctrlKey: true }), true)).toBe(false);
    expect(steerShortcutLabel(true)).toBe("⌘ Enter");
  });

  test("uses Control+Enter on Windows and Linux", () => {
    expect(isSteerShortcut(enter({ ctrlKey: true }), false)).toBe(true);
    expect(isSteerShortcut(enter({ metaKey: true }), false)).toBe(false);
    expect(steerShortcutLabel(false)).toBe("Ctrl+Enter");
  });

  test("ignores plain Enter, Shift+Enter, and other keys", () => {
    expect(isSteerShortcut(enter(), true)).toBe(false);
    expect(isSteerShortcut(enter({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isSteerShortcut(enter({ metaKey: true, altKey: true }), true)).toBe(false);
    expect(isSteerShortcut({ ...enter({ metaKey: true }), key: "a" }, true)).toBe(false);
  });
});
