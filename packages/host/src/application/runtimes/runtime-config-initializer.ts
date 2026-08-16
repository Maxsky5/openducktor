import {
  globalConfigSchema,
  knownRuntimeKindValues,
  type PersistedGlobalConfigV2,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  createDefaultGlobalConfig,
  type LoadedGlobalConfig,
  upgradePersistedGlobalConfigV2,
} from "../../config/global-config";
import type { HostOperationError } from "../../effect/host-errors";
import { discoverToolFresh, type ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export type RuntimeConfigInitializer = (
  legacyConfig: PersistedGlobalConfigV2 | null,
) => Effect.Effect<LoadedGlobalConfig, HostOperationError>;

export const createRuntimeConfigInitializer =
  (toolDiscovery: ToolDiscoveryPort): RuntimeConfigInitializer =>
  (legacyConfig) =>
    Effect.gen(function* () {
      const discoveredPaths = yield* Effect.forEach(
        knownRuntimeKindValues,
        (kind) =>
          Effect.either(discoverToolFresh(toolDiscovery, kind)).pipe(
            Effect.map(
              (result) => [kind, result._tag === "Right" ? result.right.path : ""] as const,
            ),
          ),
        { concurrency: 3 },
      );
      const executablePaths = Object.fromEntries(discoveredPaths);

      if (legacyConfig) {
        return upgradePersistedGlobalConfigV2(legacyConfig, executablePaths);
      }

      const config = createDefaultGlobalConfig();
      const agentRuntimes = Object.fromEntries(
        Object.entries(config.agentRuntimes).map(([kind, runtime]) => {
          const executablePath = executablePaths[kind] ?? "";
          return [
            kind,
            {
              ...runtime,
              enabled: executablePath.length > 0,
              executablePath,
            },
          ];
        }),
      );
      return globalConfigSchema.parse({ ...config, agentRuntimes }) as LoadedGlobalConfig;
    });
