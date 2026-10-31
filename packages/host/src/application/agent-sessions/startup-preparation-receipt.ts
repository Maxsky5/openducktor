import type { AgentSessionLiveRef, StartupPreparedHandoff } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostResourceError, type HostError } from "../../effect/host-errors";
import type {
  AgentSessionLiveRegistration,
  AgentSessionLiveAdapterRegistryPort,
} from "../../ports/agent-session-live-adapter-port";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service.types";
import type { AgentSessionLiveEnvelopeDraft } from "./agent-session-live-envelope";
import type { LiveStateCoordinator } from "./live-state-coordinator";

/** Runs under the live coordinator while the native preparation registration remains attached. */
export function createStartupPreparationFinalizer(owner: {
  adapterRegistry: AgentSessionLiveAdapterRegistryPort;
  coordinator: LiveStateCoordinator;
  read: AgentSessionLiveStateService["read"];
  requireAttached: (registration: AgentSessionLiveRegistration) => Effect.Effect<void, HostError>;
  publish: (envelope: AgentSessionLiveEnvelopeDraft) => Effect.Effect<void, HostError>;
  sequence: () => number;
}) {
  return (
    ref: AgentSessionLiveRef,
    expectedRuntimeId?: string,
  ): Effect.Effect<StartupPreparedHandoff, HostError> =>
    owner.coordinator.run(
      Effect.gen(function* () {
        const adapter = yield* owner.adapterRegistry.resolveForScope(ref);
        if (!expectedRuntimeId || expectedRuntimeId !== adapter.binding.runtimeId)
          return yield* new HostResourceError({
            resource: ref.externalSessionId,
            operation: "agent-session-live.finalize-startup",
            message:
              "The runtime that prepared the saved session is no longer confirmed. Inspect the session before starting it again.",
          });
        const observed = yield* owner.read(ref);
        if (observed.type !== "live")
          return yield* new HostResourceError({
            resource: ref.externalSessionId,
            operation: "agent-session-live.finalize-startup",
            message:
              "The saved session closed during preparation. Inspect the session before starting it again.",
          });
        yield* owner.requireAttached(adapter.binding);
        yield* owner.publish({ type: "session_upsert", session: observed.session });
        return { ref, runtimeId: adapter.binding.runtimeId, liveStateSequence: owner.sequence() };
      }),
    );
}
