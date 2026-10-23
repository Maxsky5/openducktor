import { describe, expect, test } from "bun:test";
import type { AgentMessageTarget, AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { AgentSessionResumeError } from "../../ports/agent-session-resume-error";
import type { AgentSessionOperationPolicy } from "./agent-session-operation-policy";
import { createSessionOperationOwner } from "./session-operation-owner";
import { reconcileAcceptedOutcome, sendOutcome } from "./agent-message-send-outcome";
import { AgentSessionAcceptanceUnknownError } from "../../ports/agent-session-send-error";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { noMessageQueues } from "../../test-support/message-queue-observer-test-double";
import { createAgentSessionLiveStateService } from "./agent-session-live-state-service";

const target: AgentMessageTarget = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo/tree",
  externalSessionId: "root",
  sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
};
const setup = (overrides: Partial<Parameters<typeof createSessionOperationOwner>[0]> = {}) => {
  const events: AgentSessionLiveEnvelope[] = [];
  const unexpected = () => Effect.die(new Error("unexpected preparation"));
  const policy: AgentSessionOperationPolicy = {
    run: (_target, _operation, work) => work,
    runSend: (_target, work) => work,
    validateRef: unexpected,
    prepareForkSource: () => Effect.die(new Error("unexpected fork source read")),
    prepareSend: unexpected,
    prepareResume: unexpected,
    prepareModelUpdate: unexpected,
    recordAcceptedMessage: unexpected,
  };
  const owner = createSessionOperationOwner({
    resolveRoot: () => Effect.succeed(target),
    policyFor: () => policy,
    publish: (envelope) => Effect.sync(() => events.push(envelope)).pipe(Effect.asVoid),
    retain: () => Effect.void,
    ...overrides,
  });
  return { owner, events };
};

describe("session execution ownership", () => {
  test("retains a partial publication failure without sending the settled operation again", async () => {
    const events: AgentSessionLiveEnvelope[] = [];
    const live = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      runtimeAdmission: { admit: (_runtimeKind, effect) => effect },
      messageQueues: noMessageQueues,
      faultLog: () => Effect.void,
      publish: (envelope) => {
        events.push(structuredClone(envelope));
        if (envelope.type === "session_operation_updated" && !envelope.observation.pending)
          throw new Error("Connection lost after delivery");
      },
    });
    const { owner } = setup({ publish: live.publishOperation, retain: live.retainOperation });
    let nativeCalls = 0;
    try {
      const result = await Effect.runPromise(
        Effect.result(
          owner.run(
            target,
            "submission",
            Effect.gen(function* () {
              nativeCalls += 1;
              yield* owner.controlAccepted();
            }),
          ),
        ),
      );
      expect(
        events.filter(
          (event) => event.type === "session_operation_updated" && !event.observation.pending,
        ),
      ).toHaveLength(1);
      expect(nativeCalls).toBe(1);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure")
        expect(result.failure.message).toContain("Connection lost after delivery");
      const snapshot = await Effect.runPromise(live.attach({ repoPath: target.repoPath }));
      expect(snapshot.sessionOperations).toMatchObject([
        {
          ref: { repoPath: target.repoPath, externalSessionId: target.externalSessionId },
          pending: false,
          nativeOutcome: "accepted",
          failure: { stage: "publish", code: "live_publication_failed" },
        },
      ]);
    } finally {
      await Effect.runPromise(owner.shutdown());
    }
  });

  test.each([true, false])(
    "reconciles acceptance after nested failure handoff only for the matching submission: %s",
    async (matching) => {
      const { owner } = setup();
      try {
        const settled = await Effect.runPromise(
          owner.run(
            target,
            "submission",
            Effect.gen(function* () {
              const classified = yield* sendOutcome(
                owner.run(
                  target,
                  "submission",
                  Effect.gen(function* () {
                    const options = yield* owner.options();
                    options.onSent();
                    return yield* new AgentSessionAcceptanceUnknownError({
                      message: "Native response lost",
                      messageId: "message-1",
                      cause: new Error("lost"),
                    });
                  }),
                  "submission-1",
                ),
              );
              expect(classified.kind).toBe("unknown");
              owner.observe({
                type: "transcript_event",
                event: {
                  type: "user_message",
                  sessionRef: target,
                  externalSessionId: target.externalSessionId,
                  submissionId: matching ? "submission-1" : "other-submission",
                  messageId: "message-1",
                  timestamp: "2026-10-14T00:00:00Z",
                  message: "hello",
                  parts: [],
                  state: "read",
                },
              });
              return reconcileAcceptedOutcome(classified);
            }),
            "submission-1",
          ),
        );
        expect(settled.kind).toBe(matching ? "accepted_then_failed" : "unknown");
        if (settled.kind === "accepted_then_failed")
          expect(settled.error).toMatchObject({
            failure: { acceptedMessage: { messageId: "message-1" } },
          });
        expect(
          (await Effect.runPromise(Effect.result(owner.requireStopSettled(target))))._tag,
        ).toBe(matching ? "Success" : "Failure");
      } finally {
        await Effect.runPromise(owner.shutdown());
      }
    },
  );

  test.each(["accepted", "refused", "uncertain"] as const)(
    "separates %s reattachment from user input admission after preparation fails",
    async (nativeOutcome) => {
      const { owner } = setup();
      try {
        const failed = await Effect.runPromise(
          Effect.result(
            owner.run(
              target,
              "submission",
              Effect.gen(function* () {
                const reattach = yield* owner.options("reattach");
                reattach.onSent();
                if (nativeOutcome === "accepted") reattach.onAccepted();
                return yield* new AgentSessionResumeError({
                  reason: "continuation_failed",
                  operation: "reattach",
                  sessionRef: target,
                  nativeOutcome,
                  message: "Reattachment settlement failed",
                });
              }),
            ),
          ),
        );
        expect(failed).toMatchObject({
          _tag: "Failure",
          failure: {
            observation: {
              nativeOutcome: "not_issued",
              failure: { stage: "reattach" },
            },
          },
        });
        if (nativeOutcome === "accepted")
          expect(failed).toMatchObject({ failure: { observation: { reattached: true } } });
        const later = await Effect.runPromise(
          Effect.result(owner.run(target, "submission", Effect.void)),
        );
        expect(later._tag).toBe(nativeOutcome === "uncertain" ? "Failure" : "Success");
      } finally {
        await Effect.runPromise(owner.shutdown());
      }
    },
  );

  test("caller interruption ends its wait while the host finishes admitted work", async () => {
    const { owner, events } = setup();
    const entered = Deferred.makeUnsafe<void>();
    const finish = Deferred.makeUnsafe<void>();
    const settled = Deferred.makeUnsafe<void>();
    try {
      const caller = Effect.runFork(
        owner.run(
          target,
          "submission",
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(finish);
            yield* owner.controlAccepted();
            yield* Deferred.succeed(settled, undefined);
          }),
          "submission-1",
        ),
      );
      await Effect.runPromise(Deferred.await(entered));
      await Effect.runPromise(Fiber.interrupt(caller));
      await Effect.runPromise(Deferred.succeed(finish, undefined));
      await Effect.runPromise(Deferred.await(settled));
      await Effect.runPromise(owner.run(target, "stop", Effect.void));
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session_operation_updated",
          observation: expect.objectContaining({
            submissionId: "submission-1",
            pending: false,
            nativeOutcome: "accepted",
          }),
        }),
      );
    } finally {
      await Effect.runPromise(owner.shutdown());
    }
  });

  test("Stop invalidates preparation before it waits for the session permit", async () => {
    const { owner } = setup();
    const entered = Deferred.makeUnsafe<void>();
    const finish = Deferred.makeUnsafe<void>();
    let dispatches = 0;
    try {
      const sending = Effect.runPromise(
        Effect.result(
          owner.run(
            target,
            "submission",
            Effect.gen(function* () {
              const guard = yield* owner.options();
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(finish);
              yield* Effect.try({
                try: () => {
                  guard.assertCurrent?.();
                  dispatches += 1;
                },
                catch: (cause) =>
                  new HostOperationError({ operation: "send", message: String(cause) }),
              });
            }),
          ),
        ),
      );
      await Effect.runPromise(Deferred.await(entered));
      owner.cancel(target);
      const stopping = Effect.runPromise(owner.run(target, "stop", Effect.void));
      await Effect.runPromise(Deferred.succeed(finish, undefined));
      expect((await sending)._tag).toBe("Failure");
      await stopping;
      expect(dispatches).toBe(0);
    } finally {
      await Effect.runPromise(owner.shutdown());
    }
  });

  test("nested delivery honors source cancellation after preparation", async () => {
    const { owner } = setup();
    const entered = Deferred.makeUnsafe<void>();
    const finish = Deferred.makeUnsafe<void>();
    let canceled = false;
    let dispatches = 0;
    try {
      const sending = Effect.runPromise(
        Effect.result(
          owner.run(
            target,
            "submission",
            owner.run(
              target,
              "submission",
              Effect.gen(function* () {
                const guard = yield* owner.options();
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(finish);
                yield* Effect.try({
                  try: () => {
                    guard.assertCurrent?.();
                    dispatches += 1;
                  },
                  catch: (cause) =>
                    new HostOperationError({ operation: "send", message: String(cause) }),
                });
              }),
              "submission-1",
              () => {
                if (canceled) throw new Error("Source action was canceled");
              },
            ),
            "submission-1",
          ),
        ),
      );
      await Effect.runPromise(Deferred.await(entered));
      canceled = true;
      await Effect.runPromise(Deferred.succeed(finish, undefined));
      expect(await sending).toMatchObject({
        _tag: "Failure",
        failure: { observation: { nativeOutcome: "not_issued" } },
      });
      expect(dispatches).toBe(0);
      await Effect.runPromise(owner.run(target, "submission", Effect.void));
    } finally {
      await Effect.runPromise(owner.shutdown());
    }
  });

  test("unknown issued work blocks a second operation until matching native acceptance", async () => {
    const { owner } = setup();
    try {
      const result = await Effect.runPromise(
        Effect.result(
          owner.run(
            target,
            "submission",
            Effect.gen(function* () {
              const options = yield* owner.options();
              options.onSent();
              return yield* new HostOperationError({ operation: "send", message: "response lost" });
            }),
            "submission-1",
          ),
        ),
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { observation: { nativeOutcome: "uncertain" } },
      });
      let repeats = 0;
      await Effect.runPromise(
        Effect.result(
          owner.run(
            target,
            "submission",
            Effect.sync(() => {
              repeats += 1;
            }),
          ),
        ),
      );
      expect(repeats).toBe(0);
      expect(
        owner.observe({
          type: "transcript_event",
          event: {
            type: "user_message",
            sessionRef: target,
            externalSessionId: target.externalSessionId,
            submissionId: "submission-1",
            messageId: "message-1",
            timestamp: "2026-10-13T12:00:00Z",
            message: "hello",
            parts: [{ kind: "text", text: "hello" }],
            state: "queued",
          },
        }),
      ).toMatchObject({ nativeOutcome: "accepted" });
      await Effect.runPromise(
        owner.run(
          target,
          "submission",
          Effect.sync(() => {
            repeats += 1;
          }),
        ),
      );
      expect(repeats).toBe(1);
    } finally {
      await Effect.runPromise(owner.shutdown());
    }
  });

  test("an asserted role cannot replace the current saved owner", async () => {
    const { owner } = setup();
    try {
      let dispatches = 0;
      const result = await Effect.runPromise(
        Effect.result(
          owner.run(
            { ...target, sessionScope: { kind: "workflow", taskId: "task-1", role: "qa" } },
            "submission",
            Effect.sync(() => {
              dispatches += 1;
            }),
          ),
        ),
      );
      expect(result._tag).toBe("Failure");
      expect(dispatches).toBe(0);
    } finally {
      await Effect.runPromise(owner.shutdown());
    }
  });
});
