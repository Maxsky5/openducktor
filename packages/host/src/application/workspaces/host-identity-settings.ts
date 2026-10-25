import {
  globalConfigSchema,
  type RemoteAccessSettings,
  remoteAccessSettingsSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { parseConfig } from "../../config/parse-config";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { loadGlobalConfig, type WorkspaceSettingsService } from "./workspace-settings-model";

type HostIdentitySettingsMethods = Pick<
  WorkspaceSettingsService,
  "readHostId" | "readRemoteAccessSettings" | "saveRemoteAccessSettings"
>;

/** The host ID and the remote control settings in the settings file. */
export const createHostIdentitySettingsMethods = (
  settingsConfig: SettingsConfigPort,
): HostIdentitySettingsMethods => ({
  readHostId() {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      if (config.hostId) return config.hostId;
      const hostId = yield* Effect.sync(() => crypto.randomUUID());
      const next = yield* parseConfig(globalConfigSchema, { ...config, hostId });
      yield* settingsConfig.writeConfig(next);
      return hostId;
    });
  },
  readRemoteAccessSettings() {
    return loadGlobalConfig(settingsConfig).pipe(Effect.map((config) => config.remoteAccess));
  },
  saveRemoteAccessSettings(rawSettings: RemoteAccessSettings) {
    return Effect.gen(function* () {
      const remoteAccess = yield* parseConfig(remoteAccessSettingsSchema, rawSettings);
      const config = yield* loadGlobalConfig(settingsConfig);
      const next = yield* parseConfig(globalConfigSchema, { ...config, remoteAccess });
      yield* settingsConfig.writeConfig(next);
    });
  },
});
