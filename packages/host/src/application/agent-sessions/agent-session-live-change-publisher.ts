import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { createAgentSessionExecutionEpisodes } from "./agent-session-execution-episodes";
import {
  type AgentMessageQueueObserver,
  toAgentSessionLiveEnvelope,
} from "./agent-session-live-envelope";
import type { CreateAgentSessionLiveStateServiceInput } from "./agent-session-live-state-service.types";
import type { createWorkflowLaunchHold } from "./workflow-launch-hold";

type LiveChangePublisherDependencies = {
  readonly workflowLaunchHold: ReturnType<typeof createWorkflowLaunchHold>;
  readonly executionEpisodes: ReturnType<typeof createAgentSessionExecutionEpisodes>;
  readonly projectSnapshot: (snapshot: AgentSessionLiveSnapshot) => AgentSessionLiveSnapshot;
  readonly publishEnvelopeResult: (
    envelope: AgentSessionLiveEnvelope,
    provenance?: "baseline" | "live",
  ) => Effect.Effect<HostError | null, HostError>;
  readonly observeNotificationInput: CreateAgentSessionLiveStateServiceInput["observeNotificationInput"];
  readonly messageQueues: AgentMessageQueueObserver;
};

/**
 * Publishes adapter changes in order. The renderer shows each published change, so the message
 * queues read it even if a later publication fails.
 */
export const createLiveChangePublisher =
  ({
    workflowLaunchHold,
    executionEpisodes,
    projectSnapshot,
    publishEnvelopeResult,
    observeNotificationInput,
    messageQueues,
  }: LiveChangePublisherDependencies) =>
  (changes: ReadonlyArray<AgentSessionLiveAdapterChange>): Effect.Effect<void, HostError> =>
    Effect.suspend(() => {
      const published: AgentSessionLiveEnvelope[] = [];
      const observeQueues = Effect.sync(() => messageQueues.observeChanges(published));
      return Effect.gen(function* () {
        let faultLogFailure: HostError | null = null;
        // Release holds on removal even if an earlier publication fails.
        for (const change of changes) {
          if (change.type === "session_removed") workflowLaunchHold.release(change.ref);
        }
        for (const change of changes) {
          const projected = workflowLaunchHold.projectChange(change);
          if (!projected) continue;
          const envelope = executionEpisodes.accept(
            projected.type === "session_upsert"
              ? { type: "session_upsert", session: projectSnapshot(projected.snapshot) }
              : toAgentSessionLiveEnvelope(projected),
          );
          const pausesQueue =
            envelope.type === "transcript_event" &&
            envelope.event.type === "session_turn_finished" &&
            envelope.event.turnOutcome !== "completed";
          if (pausesQueue) {
            // Native failure must pause delivery even when publishing that outcome fails.
            messageQueues.observeChanges([...published, envelope]);
            published.length = 0;
          }
          observeNotificationInput?.(envelope, change.provenance ?? "live");
          const result = yield* publishEnvelopeResult(envelope, change.provenance);
          if (!pausesQueue) published.push(envelope);
          if (faultLogFailure === null && result) faultLogFailure = result;
        }
        if (faultLogFailure) return yield* Effect.fail(faultLogFailure);
      }).pipe(Effect.ensuring(observeQueues));
    });
