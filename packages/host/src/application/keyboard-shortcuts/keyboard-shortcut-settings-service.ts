import { type ShortcutPreferences, shortcutPreferencesSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { parseConfig } from "../../config/parse-config";
import type { HostValidationErrorAggregate } from "../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";

export type KeyboardShortcutSettingsError = HostValidationErrorAggregate | SettingsConfigError;

export type KeyboardShortcutsSavedEvent = { type: "keyboard_shortcuts_saved" };

export type KeyboardShortcutSettingsDependencies = {
  settingsConfig: Pick<SettingsConfigPort, "readGlobalConfig" | "updatePreferences">;
  /** Sends an event to every attached client. */
  publish: (event: KeyboardShortcutsSavedEvent) => void;
};

const defaultShortcutPreferences: ShortcutPreferences = { version: 1, overrides: {} };

/** Reads and saves the keyboard shortcut assignments of this host. */
export const createKeyboardShortcutSettingsService = ({
  settingsConfig,
  publish,
}: KeyboardShortcutSettingsDependencies) => ({
  read: (): Effect.Effect<ShortcutPreferences, KeyboardShortcutSettingsError> =>
    Effect.gen(function* () {
      const { keyboardShortcuts } = yield* settingsConfig.readGlobalConfig();
      return yield* parseConfig(
        shortcutPreferencesSchema,
        keyboardShortcuts === undefined ? defaultShortcutPreferences : keyboardShortcuts,
      );
    }),
  save: (
    rawPreferences: ShortcutPreferences,
  ): Effect.Effect<ShortcutPreferences, KeyboardShortcutSettingsError> =>
    Effect.gen(function* () {
      const keyboardShortcuts = yield* parseConfig(shortcutPreferencesSchema, rawPreferences);
      yield* settingsConfig.updatePreferences((current) => ({
        ...current,
        // SAFETY: The parsed schema rejects undefined values; optional action keys are absent in JSON.
        keyboardShortcuts: keyboardShortcuts as JSONType,
      }));
      publish({ type: "keyboard_shortcuts_saved" });
      return keyboardShortcuts;
    }),
});

export type KeyboardShortcutSettingsService = ReturnType<
  typeof createKeyboardShortcutSettingsService
>;
