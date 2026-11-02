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
  "readHostId" | "readRemoteAccessSettings" | "saveRemoteAccessSettings"
>;

export const createHostIdentitySettingsMethods = (
  settingsConfig: SettingsConfigPort,
): HostIdentitySettingsMethods => ({
  readHostId() {
    return Effect.gen(function* () {
      const config = yield* settingsConfig.readGlobalConfig();
      if (config.hostId) return config.hostId;
      const hostId = crypto.randomUUID();
      const saved = yield* settingsConfig.updateConfig(
        (current) => globalConfigSchema.parse({ ...current, hostId: current.hostId ?? hostId }),
        [],
      );
      return yield* parseConfig(globalConfigSchema.shape.hostId.unwrap(), saved.hostId);
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
