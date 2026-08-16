import type { RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { type ToolDiscoveryPort, validateExactToolPath } from "../../ports/tool-discovery-port";

export const readSavedRuntimeExecutablePath = ({
  kind,
  settingsConfig,
}: {
  kind: RuntimeKind;
  settingsConfig: SettingsConfigPort;
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
    return config.agentRuntimes[kind].executablePath;
  });

export const resolveSavedRuntimeExecutableConfig = ({
  kind,
  settingsConfig,
  toolDiscovery,
}: {
  kind: RuntimeKind;
  settingsConfig: SettingsConfigPort;
  toolDiscovery: ToolDiscoveryPort;
}) =>
  Effect.gen(function* () {
    const configuredPath = yield* readSavedRuntimeExecutablePath({ kind, settingsConfig });
    const resolved = yield* validateExactToolPath(toolDiscovery, kind, configuredPath);
    return { configuredPath, executablePath: resolved.path };
  });

export const resolveSavedRuntimeExecutable = (input: {
  kind: RuntimeKind;
  settingsConfig: SettingsConfigPort;
  toolDiscovery: ToolDiscoveryPort;
}) =>
  resolveSavedRuntimeExecutableConfig(input).pipe(
    Effect.map(({ executablePath }) => executablePath),
  );
