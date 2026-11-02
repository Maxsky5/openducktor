import type { RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { type ToolDiscoveryPort, validateExactToolPath } from "../../ports/tool-discovery-port";

const readSavedRuntimeExecutablePath = ({
  kind,
  settingsConfig,
}: {
  kind: RuntimeKind;
  settingsConfig: SettingsConfigPort;
}) =>
  settingsConfig
    .readGlobalConfig()
    .pipe(Effect.map((config) => config.agentRuntimes[kind].executablePath));

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
