import { Effect } from "effect";
import { resolveSavedRuntimeExecutable } from "../../application/runtimes/saved-runtime-executable";
import { toHostOperationError } from "../../effect/host-errors";
import type { CreateClaudeAgentSdkServiceInput } from "./claude-agent-sdk-types";

export const resolveClaudeExecutable = (
  input: CreateClaudeAgentSdkServiceInput,
  operation: string,
) =>
  resolveSavedRuntimeExecutable({
    kind: "claude",
    settingsConfig: input.settingsConfig,
    toolDiscovery: input.toolDiscovery,
  }).pipe(Effect.mapError((cause) => toHostOperationError(cause, operation)));
