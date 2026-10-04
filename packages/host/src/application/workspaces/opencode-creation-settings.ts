import type { AgentSessionScope, OpenCodeCreationSettings } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { OpenCodeCreationSettingsPort } from "../../ports/opencode-creation-settings-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { loadGlobalConfig } from "./workspace-settings-model";

export const createOpenCodeCreationSettings = (
  config: SettingsConfigPort,
): OpenCodeCreationSettingsPort => ({
  resolve: (scope: AgentSessionScope) =>
    loadGlobalConfig(config).pipe(
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation: "opencode.creationSettings",
            message: `Cannot load permissions for a new or forked OpenCode session. Correct the saved OpenCode settings and retry. ${cause.message}`,
            cause,
          }),
      ),
      Effect.map((snapshot): OpenCodeCreationSettings => {
        const settings = snapshot.agentRuntimes.opencode;
        return {
          defaults: settings.defaults.rules.map((rule) => ({ ...rule })),
          role:
            scope.kind === "workflow"
              ? (settings.roleOverrides[scope.role]?.rules ?? []).map((rule) => ({ ...rule }))
              : [],
        };
      }),
    ),
});
