import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createLiveChangePublisher } from "./agent-session-live-change-publisher";
import { createAgentSessionExecutionEpisodes } from "./agent-session-execution-episodes";
import { createWorkflowLaunchHold } from "./workflow-launch-hold";
import {
  createHarness,
  foregroundEnd,
  sessionState,
} from "./test-support/agent-message-delivery-harness";

describe("live change publication and queue pauses", () => {
  test.each(["failed", "interrupted"] as const)(
    "retains the %s outcome when its publication fails before foreground readiness",
    async (outcome) => {
      const harness = createHarness();
      harness.outcomes.push("busy");
      await harness.submit("queued");
      harness.upsertSession({ activity: "running", foregroundTurnActive: true });
      const publicationFailure = new HostOperationError({
        operation: "test.publish",
        message: "Completion publication failed.",
      });
      const publish = createLiveChangePublisher({
        workflowLaunchHold: createWorkflowLaunchHold(),
        executionEpisodes: createAgentSessionExecutionEpisodes(),
        projectSnapshot: (snapshot) => snapshot,
        observeNotificationInput: undefined,
        messageQueues: harness.service,
        publishEnvelopeResult: (envelope) =>
          envelope.type === "transcript_event"
            ? Effect.fail(publicationFailure)
            : Effect.succeed(null),
      });
      const completion = foregroundEnd(outcome);
      if (completion.type !== "transcript_event") throw new Error("Expected completion.");
      const failure = await Effect.runPromise(
        publish([{ type: "transcript_event", event: completion.event }]),
      ).catch((cause: unknown) => cause);
      expect(failure).toBe(publicationFailure);

      await Effect.runPromise(
        publish([
          {
            type: "session_upsert",
            snapshot: sessionState({ activity: "running", foregroundTurnActive: false }),
          },
        ]),
      );
      await harness.runBackground();
      expect(harness.sentTexts()).toEqual(["queued:new_turn"]);
      expect(harness.queueTexts()).toEqual(["queued:queued"]);
      expect(harness.pause()).toContain(outcome === "failed" ? "turn failed" : "interrupted");
    },
  );
});
