import { describe, expect, test } from "bun:test";
import type { ShortcutPreferences } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";
import { createKeyboardShortcutCommandHandlers } from "./keyboard-shortcut-command-handlers";

const createRouter = () => {
  const saved: ShortcutPreferences[] = [];
  const router = toPromiseHostCommandRouter(
    createEffectHostCommandRouter({
      handlers: createKeyboardShortcutCommandHandlers({
        read: () => Effect.succeed({ version: 1, overrides: {} }),
        save: (preferences) =>
          Effect.sync(() => {
            saved.push(preferences);
            return preferences;
          }),
      }),
    }),
  );
  return { router, saved };
};

describe("createKeyboardShortcutCommandHandlers", () => {
  test("reads preferences and rejects arguments", async () => {
    const { router } = createRouter();
    expect(await router.invoke("workspace_get_keyboard_shortcuts")).toEqual({
      version: 1,
      overrides: {},
    });
    await expect(
      router.invoke("workspace_get_keyboard_shortcuts", { unexpected: true }),
    ).rejects.toThrow("workspace_get_keyboard_shortcuts does not accept arguments.");
  });

  test("validates preferences before it saves them", async () => {
    const { router, saved } = createRouter();
    await expect(router.invoke("workspace_save_keyboard_shortcuts", {})).rejects.toThrow(
      "workspace_save_keyboard_shortcuts expects argument 'preferences'.",
    );
    await expect(
      router.invoke("workspace_save_keyboard_shortcuts", {
        preferences: { version: 99, overrides: {} },
      }),
    ).rejects.toThrow();
    expect(saved).toEqual([]);
    const preferences: ShortcutPreferences = { version: 1, overrides: { palette: null } };
    expect(await router.invoke("workspace_save_keyboard_shortcuts", { preferences })).toEqual(
      preferences,
    );
    expect(saved).toEqual([preferences]);
  });
});
