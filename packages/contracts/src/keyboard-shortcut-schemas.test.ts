import { describe, expect, test } from "bun:test";
import {
  embeddedShortcutEventSchema,
  holdsShortcutMod,
  inputSignature,
  recordShortcut,
  shortcutPreferencesSchema,
  shortcutRouteSchema,
  shortcutSignature,
  type ShortcutActionId,
  type ShortcutCombination,
  type ShortcutInput,
  workflowShortcutActionId,
} from "./keyboard-shortcut-schemas";

const combination: ShortcutCombination = {
  key: { kind: "logical", key: "k" },
  mod: true,
  ctrl: false,
  alt: false,
  shift: false,
};
const input = (overrides: Partial<ShortcutInput> = {}): ShortcutInput => ({
  phase: "down",
  key: "k",
  code: "KeyK",
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
  composing: false,
  repeat: false,
  ...overrides,
});

// @ts-expect-error Built-in action IDs form a closed union.
const misspelledAction: ShortcutActionId = "pallete";

test.each([misspelledAction, "this-action-does-not-exist", "workflow::start", "workflow:custom:"])(
  "rejects undeclared or malformed action %s at preference and input boundaries",
  (commandId) => {
    expect(
      shortcutPreferencesSchema.safeParse({ version: 1, overrides: { [commandId]: combination } })
        .success,
    ).toBe(false);
    expect(shortcutRouteSchema.safeParse({ commandId, signature: "meta:k" }).success).toBe(false);
    expect(
      embeddedShortcutEventSchema.safeParse({
        type: "invoke",
        revision: 1,
        commandId,
        input: input({ meta: true }),
      }).success,
    ).toBe(false);
  },
);

test("preserves sparse defaults, cleared bindings, and unavailable workflow assignments", () => {
  const preferences = {
    version: 1,
    overrides: { palette: null, "workflow:unavailable-workflow:start": combination },
  };
  expect(shortcutPreferencesSchema.parse(preferences)).toEqual(preferences);
  expect(shortcutPreferencesSchema.parse({ version: 1, overrides: {} }).overrides).toEqual({});
});

test("rejects the device-specific shape and combinations without a modifier", () => {
  const { mod: _mod, ...deviceKeys } = combination;
  for (const palette of [
    { ...deviceKeys, meta: true },
    { ...combination, mod: false },
  ])
    expect(
      shortcutPreferencesSchema.safeParse({ version: 1, overrides: { palette } }).success,
    ).toBe(false);
});

test("workflow identities cannot collide across separators or percent signs", () => {
  const ids = [
    workflowShortcutActionId("a:b", "c"),
    workflowShortcutActionId("a", "b:c"),
    workflowShortcutActionId("a%3Ab", "c"),
    workflowShortcutActionId("a", "b%3Ac"),
  ];
  expect(new Set(ids).size).toBe(ids.length);
  expect(workflowShortcutActionId("standard", "start")).toBe("workflow:standard:start");
  expect(ids[0]).toBe("workflow:a%3Ab:c");
  for (const commandId of ids)
    expect(shortcutRouteSchema.parse({ commandId, signature: "meta:k" }).commandId).toBe(commandId);
  for (const commandId of ["workflow:a%3ab:c", "workflow:a%:c", "workflow:a:b:c"])
    expect(shortcutRouteSchema.safeParse({ commandId, signature: "meta:k" }).success).toBe(false);
});

describe("portable combinations", () => {
  test("resolve mod to Command on macOS and to Control elsewhere", () => {
    expect(shortcutSignature(combination, "darwin")).toBe("meta:k");
    expect(shortcutSignature(combination, "win32")).toBe("ctrl:k");
    expect(shortcutSignature({ ...combination, mod: false, ctrl: true }, "darwin")).toBe("ctrl:k");
    expect(shortcutSignature({ ...combination, ctrl: true }, "linux")).toBe("ctrl:k");
  });

  test("record the same portable combination on every device", () => {
    expect(recordShortcut(input({ meta: true }), "darwin")).toEqual(combination);
    expect(recordShortcut(input({ ctrl: true }), "win32")).toEqual(combination);
    expect(recordShortcut(input({ ctrl: true }), "darwin")).toEqual({
      ...combination,
      mod: false,
      ctrl: true,
    });
    expect(recordShortcut(input({ meta: true }), "linux")).toBeNull();
    expect(recordShortcut(input({ shift: true }), "darwin")).toBeNull();
    expect(
      recordShortcut(input({ key: "Meta", code: "MetaLeft", meta: true }), "darwin"),
    ).toBeNull();
  });

  test("match a recorded press on its own device", () => {
    for (const [platform, press] of [
      ["darwin", input({ meta: true, shift: true, key: "?", code: "Slash" })],
      ["win32", input({ ctrl: true, alt: true, key: "Enter", code: "Enter" })],
      ["linux", input({ ctrl: true, key: "№", code: "Digit3", shift: true })],
    ] as const) {
      const recorded = recordShortcut(press, platform);
      expect(recorded).not.toBeNull();
      expect(shortcutSignature(recorded!, platform)).toBe(inputSignature(press, platform)!);
    }
  });

  test("keep number-row keys apart from the characters they type", () => {
    expect(inputSignature(input({ meta: true, key: "&", code: "Digit1" }), "darwin")).toBe(
      "meta:#1",
    );
    expect(
      shortcutSignature({ ...combination, key: { kind: "logical", key: "&" } }, "darwin"),
    ).not.toBe("meta:#1");
  });

  test("ignore repeats, composition and AltGr character input", () => {
    expect(inputSignature(input({ meta: true, repeat: true }), "darwin")).toBeNull();
    expect(inputSignature(input({ meta: true, composing: true }), "darwin")).toBeNull();
    expect(inputSignature(input({ ctrl: true, alt: true, key: "@" }), "win32")).toBeNull();
    expect(inputSignature(input({ altGraph: true, key: "@" }), "linux")).toBeNull();
    expect(inputSignature(input({ alt: true, key: "@" }), "darwin")).toBe("alt:@");
    expect(inputSignature(input({ ctrl: true, alt: true, key: "Enter" }), "win32")).toBe(
      "ctrl+alt:enter",
    );
  });

  test("keep the serialized input functions self-contained for preview frames", () => {
    // SAFETY: The preview frame embeds these exact function sources; this runs them alone.
    const serialized = new Function(
      `return ${inputSignature.toString()}`,
    )() as typeof inputSignature;
    // SAFETY: As above, for the hint function that the preview frame embeds.
    const holds = new Function(
      `return ${holdsShortcutMod.toString()}`,
    )() as typeof holdsShortcutMod;
    expect(holds(input({ meta: true }), "darwin")).toBe(true);
    expect(holds(input({ meta: true }), "linux")).toBe(false);
    for (const press of [
      input({ meta: true }),
      input({ ctrl: true, key: "1", code: "Digit1" }),
      input({ ctrl: true, alt: true, key: "@" }),
      input({ meta: true, key: "F9", code: "F9" }),
    ])
      for (const platform of ["darwin", "win32", "linux"] as const)
        expect(serialized(press, platform)).toBe(inputSignature(press, platform));
  });
});
