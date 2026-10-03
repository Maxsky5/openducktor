import {
  resolveClaudePolicy,
  type AgentRole,
  type ClaudePolicyFields,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostValidationError,
  toHostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

export type ClaudeLaunchPolicyPort = {
  resolve(input: {
    role: AgentRole | null;
  }): Effect.Effect<ClaudePolicyFields, HostOperationErrorAggregate>;
};

export const createClaudeLaunchPolicy = (settings: SettingsConfigPort): ClaudeLaunchPolicyPort => ({
  resolve: (input) =>
    Effect.gen(function* () {
      const config = yield* settings.readConfig();
      if (!config)
        return yield* new HostValidationError({
          message: "Saved settings are missing. Open Settings and save before starting Claude.",
        });
      return resolveClaudePolicy(config.agentRuntimes.claude, input.role).settings;
    }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "claudePolicy.resolve"))),
});
