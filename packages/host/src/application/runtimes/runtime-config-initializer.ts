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
import { HostOperationError } from "../../effect/host-errors";
import type { RuntimeExecutableCheckService } from "./runtime-executable-check-service";

export type RuntimeConfigInitializer = (
  legacyConfig: PersistedGlobalConfigV2 | null,
) => Effect.Effect<LoadedGlobalConfig, HostOperationError>;

export const createRuntimeConfigInitializer =
  (checkService: RuntimeExecutableCheckService): RuntimeConfigInitializer =>
  (legacyConfig) =>
    Effect.gen(function* () {
      const check = yield* checkService.check({ mode: "discover" });
      const checksByKind = new Map<string, (typeof check.runtimes)[number]>(
        check.runtimes.map((row) => [row.kind, row]),
      );
      for (const kind of knownRuntimeKindValues) {
        if (!checksByKind.has(kind)) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "runtimeConfig.initialize",
              message: `Runtime discovery did not return a result for ${kind}`,
              details: { kind },
            }),
          );
        }
      }
      const executablePaths: Record<string, string> = {};
      for (const row of check.runtimes) {
        executablePaths[row.kind] = row.ok ? row.path : "";
      }

      if (legacyConfig) {
        return upgradePersistedGlobalConfigV2(legacyConfig, executablePaths);
      }

      const config = createDefaultGlobalConfig();
      const agentRuntimes = Object.fromEntries(
        Object.entries(config.agentRuntimes).map(([kind, runtime]) => {
          const row = checksByKind.get(kind);
          return [
            kind,
            {
              ...runtime,
              enabled: row?.ok === true,
              executablePath: row?.ok === true ? row.path : "",
            },
          ];
        }),
      );
      return globalConfigSchema.parse({ ...config, agentRuntimes }) as LoadedGlobalConfig;
    });
