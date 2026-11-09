import { describe, expect, test } from "bun:test";
import type { ShortcutCombination, ShortcutInput } from "@openducktor/contracts";
import { matchesShortcut, recordShortcut, shortcutsOverlap, shortcutLabel } from "./key-matching";

const input = (overrides: Partial<ShortcutInput> = {}): ShortcutInput => ({
  phase: "down",
  key: "k",
  code: "KeyK",
  ctrl: false,
  meta: true,
  alt: false,
  shift: false,
  composing: false,
  repeat: false,
  ...overrides,
});
const combination: ShortcutCombination = {
  key: { kind: "logical", key: "k" },
  ctrl: false,
  meta: true,
  alt: false,
  shift: false,
};

describe("shortcut input identity", () => {
  test("records and matches received punctuation without guessing the physical key", () => {
    const event = input({ key: "?", code: "KeyM", shift: true });
    const saved = recordShortcut(event, "darwin");
    expect(saved).not.toBeNull();
    expect(matchesShortcut(saved!, event, "darwin")).toBe(true);
    expect(matchesShortcut(saved!, input({ key: "m", code: "KeyM", shift: true }), "darwin")).toBe(
      false,
    );
  });
  test("uses physical number rows and explicit Shift for the two position families", () => {
    const session = { ...combination, key: { kind: "number-row", digit: "1" } } as const;
    expect(matchesShortcut(session, input({ key: "&", code: "Digit1" }), "darwin")).toBe(true);
    expect(
      matchesShortcut(session, input({ key: "1", code: "Digit1", shift: true }), "darwin"),
    ).toBe(false);
    expect(
      matchesShortcut(
        { ...session, shift: true },
        input({ key: "1", code: "Digit1", shift: true }),
        "darwin",
      ),
    ).toBe(true);
  });
  test.each([{ composing: true }, { repeat: true }, { key: "Dead" }, { phase: "up" as const }])(
    "leaves composition, repeats and key releases unclaimed: %j",
    (change) => {
      expect(matchesShortcut(combination, input(change), "darwin")).toBe(false);
      expect(recordShortcut(input(change), "darwin")).toBeNull();
    },
  );
  test("protects non-Mac AltGr characters while allowing modified Enter", () => {
    const event = input({ ctrl: true, meta: false, alt: true, altGraph: true, key: "@" });
    expect(recordShortcut(event, "win32")).toBeNull();
    expect(recordShortcut({ ...event, key: "Enter" }, "linux")).not.toBeNull();
    expect(
      recordShortcut({ ...event, ctrl: false, meta: true, key: "Enter" }, "darwin"),
    ).not.toBeNull();
  });
  test("keeps recorded number-row keys separate from logical character keys", () => {
    const event = input({ key: "№", code: "Digit3", shift: true });
    const recorded = recordShortcut(event, "darwin");
    expect(recorded?.key).toEqual({ kind: "number-row", digit: "3" });
    expect(matchesShortcut(recorded!, event, "darwin")).toBe(true);
    expect(
      matchesShortcut(
        { ...combination, key: { kind: "logical", key: "№" }, shift: true },
        event,
        "darwin",
      ),
    ).toBe(false);
    expect(matchesShortcut(combination, input({ key: "k", code: "Digit3" }), "darwin")).toBe(false);
    expect(
      shortcutsOverlap(
        { ...combination, key: { kind: "logical", key: "&" } },
        { ...combination, key: { kind: "number-row", digit: "1" } },
      ),
    ).toBe(false);
    expect(
      shortcutsOverlap(combination, { ...combination, key: { kind: "number-row", digit: "1" } }),
    ).toBe(false);
    expect(shortcutsOverlap(combination, { ...combination, shift: true })).toBe(false);
  });
});

test.each([
  [{ kind: "number-row", digit: "1" }, "⌘+Shift+1"],
  [{ kind: "logical", key: "f9" }, "⌘+Shift+F9"],
  [{ kind: "logical", key: "arrowleft" }, "⌘+Shift+ArrowLeft"],
] as const)("formats recorded keys for display", (key, label) => {
  expect(shortcutLabel({ ...combination, shift: true, key }, "darwin")).toBe(label);
});
