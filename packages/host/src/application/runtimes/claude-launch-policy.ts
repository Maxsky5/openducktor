import { resolveClaudePolicy, type ClaudePolicyFields } from "@openducktor/contracts";
import { Effect } from "effect";
import { toHostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

export type ClaudeLaunchPolicyPort = {
  resolve(input: {
    role: string | null;
  }): Effect.Effect<ClaudePolicyFields, HostOperationErrorAggregate>;
};

export const createClaudeLaunchPolicy = (settings: SettingsConfigPort): ClaudeLaunchPolicyPort => ({
  resolve: (input) =>
    Effect.gen(function* () {
      const config = yield* settings.readGlobalConfig();
      return resolveClaudePolicy(config.agentRuntimes.claude, input.role).settings;
    }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "claudePolicy.resolve"))),
});
