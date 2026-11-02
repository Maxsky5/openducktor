import { withSettingsConfigMutationTestMethods } from "./settings-config-mutations";
import type { RuntimeKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../config/global-config";
import { HostValidationError } from "../effect/host-errors";
import type { SettingsConfigPort } from "../ports/settings-config-port";

const createSettingsConfig = (
  resolveExecutablePath: () => Effect.Effect<string, HostValidationError>,
  kind: RuntimeKind,
): SettingsConfigPort => {
  const readConfig = () =>
    resolveExecutablePath().pipe(
      Effect.map((executablePath) => {
        const config = createDefaultGlobalConfig();
        return {
          ...config,
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
    );
  return withSettingsConfigMutationTestMethods({
    readConfig,
    updateConfig: (change) =>
      readConfig().pipe(
        Effect.map((current) => change(current, Object.values(current.workspaces))),
      ),
    defaultWorktreeBasePath: (workspaceId) => `/tmp/${workspaceId}`,
    defaultRepoWorktreeBasePath: () => "/tmp/repo",
    resolveConfiguredPath: (path) => path,
    canonicalizePath: (path) => Effect.succeed(path),
    pathExists: () => Effect.succeed(true),
    join: (...paths) => paths.join("/"),
  });
};

export const createFixedRuntimeSettingsConfig = (
  kind: RuntimeKind,
  executablePath: string,
): SettingsConfigPort => createSettingsConfig(() => Effect.succeed(executablePath), kind);
