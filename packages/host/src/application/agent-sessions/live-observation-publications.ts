import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
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
  readSession,
}: {
  coordinator: LiveStateCoordinator;
  observations: ReturnType<typeof createLiveWorkflowObservations>;
  readSession: AgentSessionLiveStateService["read"];
  publishEnvelope: (draft: AgentSessionLiveEnvelopeDraft) => Effect.Effect<void, HostError>;
}): Pick<
  AgentSessionLiveStateService,
  | "publishOperation"
  | "retainOperation"
  | "publishUsageLimitAutoResume"
  | "publishTaskSessionRecords"
> => ({
  publishTaskSessionRecords: (ref, records) =>
    coordinator.run(
      Effect.gen(function* () {
        // Bind ownership with current activity before a native event can pass this publication.
        const observed = yield* readSession(ref);
        const envelope: Extract<
          AgentSessionLiveEnvelope,
          { type: "task_session_records_updated" }
        > = {
          type: "task_session_records_updated",
          repoPath: ref.repoPath,
          ...records,
        };
        if (observed.type === "live") envelope.liveSession = observed.session;
        yield* publishEnvelope(envelope);
      }),
    ),
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
