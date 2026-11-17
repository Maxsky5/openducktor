import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionLiveEnvelopeDraft } from "./agent-session-live-envelope";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service.types";
import type { createLiveWorkflowObservations } from "./live-workflow-observations";
import type { LiveStateCoordinator } from "./live-state-coordinator";

/** Retains host-owned observations and publishes them in live order, under the coordinator. */
export const createLiveObservationPublications = ({
  coordinator,
  observations,
  publishEnvelope,
}: {
  coordinator: LiveStateCoordinator;
  observations: ReturnType<typeof createLiveWorkflowObservations>;
  publishEnvelope: (draft: AgentSessionLiveEnvelopeDraft) => Effect.Effect<void, HostError>;
}): Pick<
  AgentSessionLiveStateService,
  "publishOperation" | "retainOperation" | "publishUsageLimitAutoResume"
> => ({
  publishOperation: (envelope) =>
    coordinator.run(
      Effect.gen(function* () {
        observations.accept(envelope);
        yield* publishEnvelope(envelope);
      }),
    ),
  retainOperation: (observation) =>
    coordinator.run(
      Effect.sync(() => observations.accept({ type: "session_operation_updated", observation })),
    ),
  publishUsageLimitAutoResume: (ref, autoResume) =>
    coordinator.run(
      Effect.suspend(() =>
        observations.autoResume(ref, autoResume)
          ? publishEnvelope({ type: "usage_limit_auto_resume_updated", ref, autoResume })
          : Effect.void,
      ),
    ),
});
