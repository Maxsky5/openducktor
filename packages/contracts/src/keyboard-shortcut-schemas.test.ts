import { expect, test } from "bun:test";
import {
  embeddedShortcutEventSchema,
  shortcutPreferencesSchema,
  shortcutRouteSchema,
  type ShortcutActionId,
  workflowShortcutActionId,
} from "./keyboard-shortcut-schemas";

const combination = {
  key: { kind: "logical", key: "k" },
  ctrl: true,
  meta: false,
  alt: false,
  shift: false,
};

// @ts-expect-error Built-in action IDs form a closed union.
const misspelledAction: ShortcutActionId = "pallete";

test.each([misspelledAction, "this-action-does-not-exist", "workflow::start", "workflow:custom:"])(
  "rejects undeclared or malformed action %s at preference and input boundaries",
  (commandId) => {
    expect(
      shortcutPreferencesSchema.safeParse({ version: 1, overrides: { [commandId]: combination } })
        .success,
    ).toBe(false);
    expect(shortcutRouteSchema.safeParse({ commandId, combination }).success).toBe(false);
    expect(
      embeddedShortcutEventSchema.safeParse({
        type: "invoke",
        revision: 1,
        commandId,
        input: {
          ...combination,
          phase: "down",
          key: "k",
          code: "KeyK",
          repeat: false,
          composing: false,
        },
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

test("workflow identities cannot collide across separators or legacy percent signs", () => {
  const ids = [
    workflowShortcutActionId("a:b", "c"),
    workflowShortcutActionId("a", "b:c"),
    workflowShortcutActionId("a%3Ab", "c"),
    workflowShortcutActionId("a", "b%3Ac"),
  ];
  expect(new Set(ids).size).toBe(ids.length);
  expect(workflowShortcutActionId("standard", "start")).toBe("workflow:standard:start");
  expect(ids[0]).toBe("workflow-action:a%3Ab:c");
  for (const commandId of ids)
    expect(shortcutRouteSchema.parse({ commandId, combination }).commandId).toBe(commandId);
  for (const commandId of [
    "workflow-action:a%3ab:c",
    "workflow-action:a%:c",
    "workflow-action:a:b:c",
    "workflow-action:a:b",
  ])
    expect(shortcutRouteSchema.safeParse({ commandId, combination }).success).toBe(false);
});
