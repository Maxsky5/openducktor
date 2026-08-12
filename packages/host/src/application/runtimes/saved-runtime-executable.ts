import type { RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { type ToolDiscoveryPort, validateExactToolPath } from "../../ports/tool-discovery-port";

export const resolveSavedRuntimeExecutable = ({
  kind,
  settingsConfig,
  toolDiscovery,
}: {
  kind: RuntimeKind;
  settingsConfig: SettingsConfigPort;
  toolDiscovery: ToolDiscoveryPort;
}) =>
  Effect.gen(function* () {
    const config = yield* settingsConfig.readConfig();
    if (!config) {
      return yield* Effect.fail(
        new HostValidationError({
          field: `agentRuntimes.${kind}.executablePath`,
          message: `${kind} runtime settings are not initialized. Open Settings and configure its executable path.`,
        }),
      );
    }
    const runtimeConfig = config.agentRuntimes[kind];
    return (yield* validateExactToolPath(toolDiscovery, kind, runtimeConfig.executablePath)).path;
  });
