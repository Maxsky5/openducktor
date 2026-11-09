import {
  globalConfigSchema,
  shortcutPreferencesSchema,
  type ShortcutPreferences,
  type RemoteAccessSettings,
  remoteAccessSettingsSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { parseConfig } from "../../config/parse-config";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

type HostIdentitySettingsMethods = Pick<
  WorkspaceSettingsService,
  | "readRemoteAccessSettings"
  | "saveRemoteAccessSettings"
  | "readKeyboardShortcuts"
  | "saveKeyboardShortcuts"
>;

export const createHostIdentitySettingsMethods = (
  settingsConfig: SettingsConfigPort,
): HostIdentitySettingsMethods => ({
  readKeyboardShortcuts() {
    return Effect.gen(function* () {
      const config = yield* settingsConfig.readGlobalConfig();
      return yield* parseConfig(
        shortcutPreferencesSchema,
        config.keyboardShortcuts === undefined
          ? { version: 1, overrides: {} }
          : config.keyboardShortcuts,
      );
    });
  },
  saveKeyboardShortcuts(rawPreferences: ShortcutPreferences) {
    return Effect.gen(function* () {
      const keyboardShortcuts = yield* parseConfig(shortcutPreferencesSchema, rawPreferences);
      yield* settingsConfig.updatePreferences((current) => ({
        ...current,
        // SAFETY: The parsed schema rejects undefined values; optional action keys are absent in JSON.
        keyboardShortcuts: keyboardShortcuts as JSONType,
      }));
      return keyboardShortcuts;
    });
  },
  readRemoteAccessSettings() {
    return settingsConfig.readGlobalConfig().pipe(Effect.map((config) => config.remoteAccess));
  },
  saveRemoteAccessSettings(rawSettings: RemoteAccessSettings) {
    return Effect.gen(function* () {
      const remoteAccess = yield* parseConfig(remoteAccessSettingsSchema, rawSettings);
      yield* settingsConfig.updateConfig(
        (current) => globalConfigSchema.parse({ ...current, remoteAccess }),
        [],
      );
    });
  },
});
