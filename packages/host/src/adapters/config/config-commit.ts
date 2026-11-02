import type { GlobalConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { SettingsConfigPort, SettingsConfigView } from "../../ports/settings-config-port";

/** Reports the fields that each durable settings write committed. */
export const withConfigCommit = (
  port: SettingsConfigPort,
  committed: (config: SettingsConfigView) => Effect.Effect<void>,
): SettingsConfigPort => {
  const observe = (config: GlobalConfig, workspaceIds?: readonly string[]) =>
    Effect.gen(function* () {
      if (workspaceIds === undefined) return yield* committed(config);
      const catalog = yield* port.readWorkspaceCatalogSnapshot(config).pipe(
        Effect.mapError(
          (cause) =>
            new HostOperationError({
              operation: "settingsConfig.observeCommit",
              message:
                "Settings saved, but workspace observation did not refresh. Reload the host to use the saved settings.",
              cause,
            }),
        ),
      );
      yield* committed({
        ...config,
        workspaces: Object.fromEntries(
          catalog.workspaces.map((workspace) => [workspace.workspaceId, workspace]),
        ),
      });
    });
  return {
    ...port,
    applyConfigChange: (change, workspaceIds) =>
      port.applyConfigChange(change, workspaceIds).pipe(
        Effect.tap((result) => observe(result.config, workspaceIds)),
        Effect.uninterruptible,
      ),
    updateConfig: (change, workspaceIds) =>
      port.updateConfig(change, workspaceIds).pipe(
        Effect.tap((config) => observe(config, workspaceIds)),
        Effect.uninterruptible,
      ),
  };
};
