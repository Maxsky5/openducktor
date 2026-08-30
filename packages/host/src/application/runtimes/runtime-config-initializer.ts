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
import { HostOperationError, type HostValidationError } from "../../effect/host-errors";
import {
  discoverToolFresh,
  type ToolDiscoveryDetails,
  type ToolDiscoveryPort,
} from "../../ports/tool-discovery-port";

export type RuntimeConfigInitializer = (
  legacyConfig: PersistedGlobalConfigV2 | null,
) => Effect.Effect<
  LoadedGlobalConfig,
  HostOperationError<ToolDiscoveryDetails> | HostValidationError<ToolDiscoveryDetails>
>;

export const createRuntimeConfigInitializer =
  (toolDiscovery: ToolDiscoveryPort): RuntimeConfigInitializer =>
  (legacyConfig) =>
    Effect.gen(function* () {
      const discoveredPaths = yield* Effect.forEach(
        knownRuntimeKindValues,
        (kind) =>
          discoverToolFresh(toolDiscovery, kind).pipe(
            Effect.map((resolved) => [kind, resolved.path] as const),
            Effect.catchTag("HostDependencyError", (error) => {
              if (error.details?.requiredSource === true) {
                return Effect.fail(
                  new HostOperationError({
                    operation: "runtimeConfig.initialize",
                    message: error.message,
                    cause: error,
                    details: error.details,
                  }),
                );
              }
              return Effect.succeed([kind, ""] as const);
            }),
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
      return globalConfigSchema.parse({ ...config, agentRuntimes });
    });
