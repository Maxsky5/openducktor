import type { GlobalConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

export const withNotificationConfigCommit = (
  port: SettingsConfigPort,
  committed: (config: GlobalConfig) => Effect.Effect<void>,
): SettingsConfigPort => ({
  ...port,
  writeConfig: (config) =>
    Effect.uninterruptible(
      port.writeConfig(config).pipe(Effect.zipRight(Effect.suspend(() => committed(config)))),
    ),
});
