import type { RepoConfig, RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../config/global-config";
import { HostValidationError } from "../effect/host-errors";
import type { SettingsConfigPort } from "../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../ports/tool-discovery-port";

const createSettingsConfig = (
  resolveExecutablePath: () => Effect.Effect<string, HostValidationError>,
  kind: RuntimeKind,
  workspaces: Record<string, RepoConfig> = {},
): SettingsConfigPort => ({
  readConfig: () =>
    resolveExecutablePath().pipe(
      Effect.map((executablePath) => {
        const config = createDefaultGlobalConfig();
        return {
          ...config,
          workspaces,
          agentRuntimes: {
            ...config.agentRuntimes,
            [kind]: {
              ...config.agentRuntimes[kind],
              enabled: true,
              executablePath,
            },
          },
        };
      }),
    ),
  writeConfig: () => Effect.void,
  defaultWorktreeBasePath: (workspaceId) => `/tmp/${workspaceId}`,
  defaultRepoWorktreeBasePath: () => "/tmp/repo",
  resolveConfiguredPath: (path) => path,
  canonicalizePath: (path) => Effect.succeed(path),
  pathExists: () => Effect.succeed(true),
  join: (...paths) => paths.join("/"),
});

export const createFixedRuntimeSettingsConfig = (
  kind: RuntimeKind,
  executablePath: string,
  workspaces: Record<string, RepoConfig> = {},
): SettingsConfigPort =>
  createSettingsConfig(() => Effect.succeed(executablePath), kind, workspaces);

export const createDiscoveredRuntimeSettingsConfig = (
  kind: RuntimeKind,
  toolDiscovery: ToolDiscoveryPort,
): SettingsConfigPort =>
  createSettingsConfig(
    () =>
      toolDiscovery.resolveToolPath(kind).pipe(
        Effect.mapError(
          (cause) =>
            new HostValidationError({
              field: `agentRuntimes.${kind}.executablePath`,
              message: cause.message,
              cause,
            }),
        ),
      ),
    kind,
  );
