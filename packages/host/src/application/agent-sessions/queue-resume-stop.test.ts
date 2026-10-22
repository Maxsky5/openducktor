import { expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import { AgentSessionBusyError } from "../../ports/agent-session-send-error";
import { createSessionOperationOwner } from "./session-operation-owner";
import { createAgentMessageDeliveryService } from "./agent-message-delivery-service";

const target = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "session",
  sessionScope: { kind: "repository" as const },
};

test("Stop during queue Resume preparation retains the pause and prevents post-Stop delivery", async () => {
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
    publish: () => Effect.void,
  });
  const entered = Deferred.makeUnsafe<void>();
  const finish = Deferred.makeUnsafe<void>();
  const background: Effect.Effect<void>[] = [];
  let first = true;
  let stopped = false;
  let sentAfterStop = 0;
  const delivery = createAgentMessageDeliveryService({
    submissionFingerprint: JSON.stringify,
    canonicalizeRepoPath: Effect.succeed,
    runOperation: (ref, work, id) => owner.run(ref, "submission", work, id),
    commitQueueResume: (commit) => owner.commit(commit),
    prepare: Effect.succeed,
    prepareQueueResume: () =>
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(finish))),
    send: (input) =>
      owner.run(
        input,
        "submission",
        Effect.gen(function* () {
          const guard = yield* owner.options();
          guard.assertCurrent?.();
          if (first) {
            first = false;
            return yield* new AgentSessionBusyError({ message: "busy", cause: new Error("busy") });
          }
          guard.onSent();
          if (stopped) sentAfterStop += 1;
          const accepted = {
            type: "user_message" as const,
            externalSessionId: "session",
            timestamp: "2026-10-13T12:00:00Z",
            messageId: "message",
            message: "hello",
            parts: [],
            state: "read" as const,
          };
          yield* owner.accepted(accepted);
          return accepted;
        }),
        input.submissionId,
      ),
    steeringAvailability: () => Effect.succeed({ available: true }),
    publish: () => {},
    runInBackground: (work) => background.push(work),
    now: () => "2026-10-13T12:00:00Z",
  });
  try {
    await Effect.runPromise(
      delivery.submit({
        ...target,
        submissionId: "one",
        mode: "default",
        parts: [{ kind: "text", text: "hello" }],
      }),
    );
    await Effect.runPromise(delivery.pauseForStop(target));
    const resuming = Effect.runPromise(
      Effect.result(delivery.manage({ ...target, action: { kind: "resume" } })),
    );
    await Effect.runPromise(Deferred.await(entered));
    owner.cancel(target);
    await Effect.runPromise(delivery.pauseForStop(target));
    const stopping = Effect.runPromise(
      owner.run(
        target,
        "stop",
        Effect.sync(() => {
          stopped = true;
        }),
      ),
    );
    await Effect.runPromise(Deferred.succeed(finish, undefined));
    expect((await resuming)._tag).toBe("Failure");
    await stopping;
    for (const work of background) await Effect.runPromise(work);
    expect(sentAfterStop).toBe(0);
    expect(delivery.listQueues("/repo")).toMatchObject([
      {
        pause: { message: "You stopped the agent. Resume the queue to send the next message." },
        entries: [
          { submissionId: "one", state: "queued", parts: [{ kind: "text", text: "hello" }] },
        ],
      },
    ]);
  } finally {
    await Effect.runPromise(owner.shutdown());
  }
});
