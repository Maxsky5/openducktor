import { homedir } from "node:os";
import { Effect } from "effect";
import { resolveSavedRuntimeExecutableConfig } from "../../application/runtimes/saved-runtime-executable";
import { toHostOperationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { readAntigravityModelCatalog } from "./antigravity-models";

/**
 * Reads the Antigravity models for a repository that is not a workspace yet. `agy models` needs no
 * session and no ACP process, and it connects no MCP bridge.
 */
export const createAntigravityModelCatalogPreview =
  ({
    settingsConfig,
    toolDiscovery,
    readEnv,
  }: {
    settingsConfig: SettingsConfigPort;
    toolDiscovery: ToolDiscoveryPort;
    readEnv: () => NodeJS.ProcessEnv;
  }) =>
  (_repoPath: string) =>
    Effect.gen(function* () {
      const { executablePath } = yield* resolveSavedRuntimeExecutableConfig({
        kind: "antigravity",
        settingsConfig,
        toolDiscovery,
      });
      return yield* Effect.tryPromise({
        try: () => readAntigravityModelCatalog({ executablePath, env: readEnv(), cwd: homedir() }),
        catch: (cause) => toHostOperationError(cause, "antigravityModelCatalogPreview.read"),
      });
    });
