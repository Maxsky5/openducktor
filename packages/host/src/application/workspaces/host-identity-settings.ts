import {
  globalConfigSchema,
  type RemoteAccessSettings,
  remoteAccessSettingsSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { parseConfig } from "../../config/parse-config";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

type HostIdentitySettingsMethods = Pick<
  WorkspaceSettingsService,
  "readRemoteAccessSettings" | "saveRemoteAccessSettings"
>;

export const createHostIdentitySettingsMethods = (
  settingsConfig: SettingsConfigPort,
): HostIdentitySettingsMethods => ({
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
