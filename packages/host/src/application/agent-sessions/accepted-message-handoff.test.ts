import { expect, test } from "bun:test";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  AgentSessionAcceptanceUnknownError,
  AgentSessionBusyError,
} from "../../ports/agent-session-send-error";
import { createAgentMessageDeliveryService } from "./agent-message-delivery-service";
import { createSessionOperationOwner } from "./session-operation-owner";

const target = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "session",
  sessionScope: { kind: "repository" as const },
};

test.each(["default", "steer"] as const)(
  "%s retains acceptance observed between native failure classification and host settlement",
  async (mode) => {
    const observations: AgentSessionLiveEnvelope[] = [];
    const unexpected = () => Effect.die(new Error("Unexpected policy preparation"));
    const owner = createSessionOperationOwner({
      resolveRoot: () => Effect.succeed(target),
      retain: () => Effect.void,
      policyFor: () => ({
        run: (_ref, _operation, work) => work,
        runSend: (_ref, work) => work,
        validateRef: unexpected,
        prepareForkSource: () => Effect.die(new Error("unexpected fork source read")),
        prepareSend: unexpected,
        prepareResume: unexpected,
        prepareModelUpdate: unexpected,
        recordAcceptedMessage: unexpected,
      }),
      publish: (envelope) =>
        Effect.sync(() => {
          observations.push(envelope);
        }),
    });
    let nativeSends = 0;
    const delivery = createAgentMessageDeliveryService({
      submissionFingerprint: JSON.stringify,
      canonicalizeRepoPath: Effect.succeed,
      runOperation: (ref, work, id) => owner.run(ref, "submission", work, id),
      commitQueueResume: (commit) => owner.commit(commit),
      prepareQueueResume: () => Effect.void,
      prepare: Effect.succeed,
      send: (input) =>
        owner.run(
          input,
          "submission",
          Effect.gen(function* () {
            if (input.submissionId !== "accepted")
              return yield* new AgentSessionBusyError({
                message: "A turn is running",
                cause: new Error("busy"),
              });
            const options = yield* owner.options();
            options.onSent();
            nativeSends += 1;
            const failure = new AgentSessionAcceptanceUnknownError({
              message: "Native response lost",
              messageId: "message",
              cause: new Error("Connection closed"),
            });
            return yield* Effect.fail(failure).pipe(
              Effect.onExit(() =>
                Effect.sync(() => {
                  const accepted: AgentSessionLiveEnvelope = {
                    type: "transcript_event",
                    event: {
                      type: "user_message",
                      sessionRef: target,
                      externalSessionId: target.externalSessionId,
                      timestamp: "2026-10-14T00:00:00Z",
                      submissionId: "accepted",
                      messageId: "message",
                      message: "hello",
                      parts: [{ kind: "text", text: "hello" }],
                      state: "read",
                    },
                  };
                  owner.observe(accepted);
                  delivery.observeChanges([accepted]);
                }),
              ),
            );
          }),
          input.submissionId,
        ),
      steeringAvailability: () => Effect.succeed({ available: true }),
      publish: () => {},
      runInBackground: () => {},
      now: () => "2026-10-14T00:00:00Z",
    });
    const intent = {
      ...target,
      submissionId: "accepted",
      mode,
      parts: [{ kind: "text" as const, text: "hello" }],
    };
    try {
      if (mode === "steer") {
        await Effect.runPromise(
          delivery.submit({ ...intent, mode: "default", submissionId: "later" }),
        );
        delivery.observeChanges([
          {
            type: "session_upsert",
            session: {
              ref: target,
              activity: "running",
              title: "Chat",
              startedAt: "2026-10-14T00:00:00Z",
              pendingApprovals: [],
              pendingQuestions: [],
              contextUsage: null,
            },
          },
        ]);
      }
      const result = await Effect.runPromise(Effect.result(delivery.submit(intent)));
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          observation: { nativeOutcome: "accepted", acceptedInput: { messageId: "message" } },
        },
      });
      expect(delivery.listQueues("/repo").flatMap((queue) => queue.entries)).not.toContainEqual(
        expect.objectContaining({ submissionId: "accepted" }),
      );
      if (mode === "steer") {
        expect(delivery.listQueues("/repo")[0]).toMatchObject({
          entries: [{ submissionId: "later", state: "queued" }],
          pause: { message: expect.stringContaining("The agent received the message") },
        });
        await Effect.runPromise(delivery.manage({ ...target, action: { kind: "resume" } }));
      }
      const duplicate = await Effect.runPromise(Effect.result(delivery.submit(intent)));
      expect(duplicate).toMatchObject({
        _tag: "Failure",
        failure: { observation: { nativeOutcome: "accepted" } },
      });
      await Effect.runPromise(owner.requireStopSettled(target));
      expect(nativeSends).toBe(1);
      expect(observations).toContainEqual(
        expect.objectContaining({
          type: "session_operation_updated",
          observation: expect.objectContaining({
            submissionId: "accepted",
            pending: false,
            nativeOutcome: "accepted",
          }),
        }),
      );
    } finally {
      await Effect.runPromise(owner.shutdown());
    }
  },
);
