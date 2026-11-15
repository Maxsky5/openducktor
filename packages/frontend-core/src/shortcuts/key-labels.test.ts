import { expect, test } from "bun:test";
import type { ShortcutCombination } from "@openducktor/contracts";
import { ariaKeyShortcut, shortcutKeyParts, shortcutLabel, spokenShortcut } from "./key-labels";

const combination: ShortcutCombination = {
  key: { kind: "logical", key: "k" },
  mod: true,
  ctrl: false,
  alt: false,
  shift: true,
};

test.each([
  [{ kind: "number-row", digit: "1" }, "⇧⌘1", "Ctrl+Shift+1"],
  [{ kind: "logical", key: "f9" }, "⇧⌘F9", "Ctrl+Shift+F9"],
  [{ kind: "logical", key: "arrowleft" }, "⇧⌘←", "Ctrl+Shift+←"],
  [{ kind: "logical", key: "enter" }, "⇧⌘↵", "Ctrl+Shift+Enter"],
] as const)("labels one portable combination for each device", (key, mac, other) => {
  expect(shortcutLabel({ ...combination, key }, "darwin")).toBe(mac);
  expect(shortcutLabel({ ...combination, key }, "linux")).toBe(other);
  expect(shortcutLabel({ ...combination, key }, "win32")).toBe(other);
});

test("orders macOS modifiers as Control, Option, Shift, Command", () => {
  expect(shortcutKeyParts({ ...combination, ctrl: true, alt: true }, "darwin")).toEqual([
    "⌃",
    "⌥",
    "⇧",
    "⌘",
    "K",
  ]);
  expect(ariaKeyShortcut(combination, "darwin")).toBe("Meta+Shift+K");
  expect(ariaKeyShortcut(combination, "win32")).toBe("Control+Shift+K");
});

test("spells keys in words for screen readers", () => {
  expect(spokenShortcut(combination, "darwin")).toBe("Shift Command K");
  expect(spokenShortcut({ ...combination, key: { kind: "logical", key: "enter" } }, "linux")).toBe(
    "Ctrl Shift Enter",
  );
});
