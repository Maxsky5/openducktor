import { Effect, Exit } from "effect";
import { HostOperationError, type HostError } from "../../effect/host-errors";
import type {
  AgentSessionRuntimeAdapterPort,
  AgentSessionSettingsRef,
} from "../../ports/agent-session-live-adapter-port";

export type WithSessionSettings = <A>(
  input: AgentSessionSettingsRef,
  operation: (adapter: AgentSessionRuntimeAdapterPort) => Effect.Effect<A, HostError>,
) => Effect.Effect<A, HostError>;

export const holdSessionSettings = <A>(
  adapter: AgentSessionRuntimeAdapterPort,
  input: AgentSessionSettingsRef,
  operation: (adapter: AgentSessionRuntimeAdapterPort) => Effect.Effect<A, HostError>,
): Effect.Effect<A, HostError> =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const release = yield* adapter.holdSessionTurns(input);
      const result = yield* Effect.exit(operation(adapter));
      const released = yield* Effect.result(release);
      if (released._tag === "Failure") {
        if (Exit.isFailure(result))
          return yield* new HostOperationError({
            operation: "agent-session.release-settings",
            message: `Session setting failed and turn release failed: ${released.failure.message}`,
            cause: {
              operationCause: result.cause,
              releaseFailure: released.failure,
            },
          });
        return yield* Effect.fail(released.failure);
      }
      return Exit.isFailure(result) ? yield* Effect.failCause(result.cause) : result.value;
    }),
  );
