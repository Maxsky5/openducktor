import { Effect } from "effect";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import type { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type { HostError } from "../../effect/host-errors";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import type { createRuntimeSessionEngagement } from "./agent-session-runtime-engagement";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import {
  continuationSessionRef,
  toContinuationResolutionError,
} from "./agent-session-continuation-errors";

export const createLiveContinuation = (
  adapterRegistry: AgentSessionLiveAdapterRegistryPort,
  engagement: ReturnType<typeof createRuntimeSessionEngagement>,
  requireAttached: (binding: AgentSessionLiveRegistration) => Effect.Effect<void, HostError>,
): AgentSessionLiveStateService["continueInterruptedTurn"] => {
  const continuationsInFlight = new Set<string>();
  return (input) =>
    Effect.gen(function* () {
      const adapter = yield* adapterRegistry.resolveControlForScope(input).pipe(
        Effect.map(engagement.trackControls),
        Effect.mapError((cause) => toContinuationResolutionError(cause, input)),
      );
      const continuationKey = [
        adapter.binding.runtimeId,
        input.externalSessionId,
        input.workingDirectory,
      ].join("\u0000");
      if (continuationsInFlight.has(continuationKey)) {
        return yield* Effect.fail(
          new AgentSessionResumeError({
            reason: "continuation_in_progress",
            sessionRef: continuationSessionRef(input),
            operation: "agent-session.continue-interrupted-turn",
            message: `Session '${input.externalSessionId}' already has a continuation in progress. Wait for it to settle, then retry Resume.`,
          }),
        );
      }
      continuationsInFlight.add(continuationKey);
      const summary = yield* adapter
        .continueInterruptedTurn(input)
        .pipe(Effect.ensuring(Effect.sync(() => continuationsInFlight.delete(continuationKey))));
      yield* requireAttached(adapter.binding).pipe(
        Effect.mapError(
          (cause) =>
            new AgentSessionResumeError({
              reason: "runtime_unavailable",
              nativeOutcome: "accepted",
              sessionRef: continuationSessionRef(input),
              operation: "agent-session.continue-interrupted-turn",
              message: `${cause.message} The adapter already accepted the continuation, so the runtime can be working on it.`,
              nextAction:
                "Inspect the runtime and this session. Retry Resume only if the turn is still unfinished.",
              cause,
            }),
        ),
      );
      return summary;
    });
};
