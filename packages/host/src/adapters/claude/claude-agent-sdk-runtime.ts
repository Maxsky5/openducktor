import { Effect } from "effect";
import { resolveSavedRuntimeExecutable } from "../../application/runtimes/saved-runtime-executable";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { CreateClaudeAgentSdkServiceInput } from "./claude-agent-sdk-types";

export const resolveClaudeExecutable = (
  input: CreateClaudeAgentSdkServiceInput,
  operation: string,
) =>
  input.settingsConfig
    ? resolveSavedRuntimeExecutable({
        kind: "claude",
        settingsConfig: input.settingsConfig,
        toolDiscovery: input.toolDiscovery,
      }).pipe(Effect.mapError((cause) => toHostOperationError(cause, operation)))
    : Effect.fail(
        new HostValidationError({
          field: "agentRuntimes.claude.executablePath",
          message: "Claude runtime settings are not configured.",
        }),
      );
