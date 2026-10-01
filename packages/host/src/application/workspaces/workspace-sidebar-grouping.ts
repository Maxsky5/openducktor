import {
  globalConfigSchema,
  type SettingsSnapshot,
  type SidebarSessionGrouping,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { parseConfig } from "../../config/parse-config";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import {
  loadGlobalConfig,
  toSettingsSnapshot,
  type WorkspaceSettingsError,
} from "./workspace-settings-model";

export const updateSidebarSessionGrouping = (
  settingsConfig: SettingsConfigPort,
  sidebarSessionGrouping: SidebarSessionGrouping,
): Effect.Effect<SettingsSnapshot, WorkspaceSettingsError> =>
  Effect.gen(function* () {
    const config = yield* loadGlobalConfig(settingsConfig);
    const nextConfig = yield* parseConfig(globalConfigSchema, {
      ...config,
      appearance: { ...config.appearance, sidebarSessionGrouping },
    });
    yield* settingsConfig.writeConfig(nextConfig);
    return yield* Effect.try({
      try: () => toSettingsSnapshot(nextConfig),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  });
