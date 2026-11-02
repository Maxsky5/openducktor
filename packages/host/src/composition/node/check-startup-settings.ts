import { Effect } from "effect";
import path from "node:path";
import { readSettingsConfigFile } from "../../adapters/settings/settings-config-file";
import {
  resolveOpenDucktorBaseDir,
  type OpenDucktorConfigDirScope,
} from "../../config/openducktor-config-dir";
import { isHostError, toHostOperationError } from "../../effect/host-errors";
import { toHostStorageStartupError } from "./host-startup-storage-error";

export const checkStartupSettingsEffect = (
  scope: OpenDucktorConfigDirScope,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.try({
    try: () => path.join(resolveOpenDucktorBaseDir(scope, environment), "config.json"),
    catch: (cause) =>
      isHostError(cause)
        ? cause
        : toHostOperationError(cause, "settingsConfig.resolveConfigDirectory"),
  }).pipe(
    Effect.flatMap(readSettingsConfigFile),
    Effect.asVoid,
    Effect.mapError(toHostStorageStartupError),
  );
