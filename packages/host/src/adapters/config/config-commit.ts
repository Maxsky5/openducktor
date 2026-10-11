import type { GlobalConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

/** Reports each config after its durable write succeeds. A failed write reports nothing. */
export const withConfigCommit = (
  port: SettingsConfigPort,
  committed: (config: GlobalConfig) => Effect.Effect<void>,
): SettingsConfigPort => ({
  ...port,
  writeConfig: (config) =>
    Effect.uninterruptible(
      port.writeConfig(config).pipe(Effect.andThen(Effect.suspend(() => committed(config)))),
    ),
});
