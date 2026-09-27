import { Effect } from "effect";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import {
  resolveOpenDucktorBaseDir,
  type OpenDucktorConfigDirScope,
} from "../../config/openducktor-config-dir";
import { isHostError, toHostOperationError } from "../../effect/host-errors";

export const checkStartupSettingsEffect = (
  scope: OpenDucktorConfigDirScope,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.try({
    try: () =>
      createSettingsConfigAdapter({ configDir: resolveOpenDucktorBaseDir(scope, environment) }),
    catch: (cause) =>
      isHostError(cause)
        ? cause
        : toHostOperationError(cause, "settingsConfig.resolveConfigDirectory"),
  }).pipe(
    Effect.flatMap((adapter) => adapter.readConfig({ initialize: false })),
    Effect.asVoid,
  );
