import type { AgentSessionLiveAllowDeniedActionInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";

/** Runs the Allow of one denied call, or fails for a runtime that cannot allow denied calls. */
export const allowRuntimeDeniedAction = (
  adapter: AgentSessionRuntimeAdapterPort,
  input: AgentSessionLiveAllowDeniedActionInput,
): Effect.Effect<void, HostError> =>
  adapter.allowDeniedAction
    ? adapter.allowDeniedAction(input)
    : Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Runtime '${input.runtimeKind}' cannot allow denied tool calls.`,
          details: { runtimeKind: input.runtimeKind },
        }),
      );
