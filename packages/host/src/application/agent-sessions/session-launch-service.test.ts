import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import type {
  AcceptedAgentInput,
  AgentSessionControlSendInput,
  AgentSessionLiveRef,
  SessionLaunchResult,
} from "@openducktor/contracts";
import { HostOperationError } from "../../effect/host-errors";
import {
  AgentSessionCommandAcceptedError,
  AgentSessionMessageRejectedError,
} from "../../ports/agent-session-send-error";
import type { AgentSessionSendOptions } from "../../ports/agent-session-live-adapter-port";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import { createSessionLaunchService } from "./session-launch-service";

type Request = {
  key: string;
  sessionId: string;
  /** The run completes it when it reaches the gate. */
  entered?: Deferred.Deferred<void>;
  gate?: Deferred.Deferred<void>;
};

const refFor = (sessionId: string): AgentSessionLiveRef => ({
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo",
  externalSessionId: sessionId,
});
const parts: AgentSessionControlSendInput["parts"] = [{ kind: "text", text: "First message" }];

const fixture = (accepted?: AcceptedAgentInput) => {
  const sends: string[] = [];
  const sendOptions: Array<AgentSessionSendOptions | undefined> = [];
  // The fake issues the native request before its gate unless a test fails the send earlier.
  let issueSend = true;
  const reports: Array<[string, string]> = [];
  const reported = Deferred.makeUnsafe<void>();
  let reportFailure = false;
  let reportVisible = true;
  const stops: string[] = [];
  const holds: Array<[string, boolean]> = [];
  let holdFailure = false;
  let stopFailure = false;
  let sendGate: Effect.Effect<void, HostOperationError> = Effect.void;
  const runtime: Pick<
    SessionLaunchRuntimePort,
    "sendUserMessage" | "holdWorkflowLaunch" | "stopSession" | "reportLaunchFailure"
  > = {
    reportLaunchFailure: (ref, message) =>
      Effect.suspend(() => {
        reports.push([ref.externalSessionId, message]);
        if (reportFailure)
          return Effect.fail(
            new HostOperationError({ operation: "report", message: "Report failed" }),
          );
        return Effect.succeed(reportVisible ? `notice-${reports.length}` : null);
      }).pipe(Effect.ensuring(Deferred.succeed(reported, undefined))),
    sendUserMessage: (input, options) =>
      Effect.suspend(() => {
        sends.push(input.externalSessionId);
        sendOptions.push(options);
        if (issueSend) options?.onSent?.();
        return sendGate;
      }).pipe(
        Effect.as<AcceptedAgentInput>(
          accepted ?? {
            type: "user_message",
            externalSessionId: input.externalSessionId,
            messageId: "message-1",
            message: "First message",
            parts: [{ kind: "text", text: "First message" }],
            timestamp: "2026-10-09T00:00:00Z",
            state: "read",
          },
        ),
      ),
    holdWorkflowLaunch: (ref, held) =>
      holdFailure && !held
        ? Effect.fail(new HostOperationError({ operation: "hold", message: "Hold release failed" }))
        : Effect.sync(() => {
            holds.push([ref.externalSessionId, held]);
          }),
    stopSession: (ref) =>
      Effect.suspend(() => {
        stops.push(ref.externalSessionId);
        return stopFailure
          ? Effect.fail(new HostOperationError({ operation: "stop", message: "Stop failed" }))
          : Effect.void;
      }),
  };
  const service = createSessionLaunchService<Request, SessionLaunchResult>({
    runtime,
    initial: () => ({ workspaceId: "workspace", repoPath: "/repo", status: "completed" }),
    key: (request) => request.key,
    run: (attempt) =>
      Effect.gen(function* () {
        const { sessionId, entered, gate } = attempt.request;
        yield* attempt.createdSession(
          "/repo",
          {
            externalSessionId: sessionId,
            runtimeKind: "codex",
            workingDirectory: "/repo",
            startedAt: "2026-10-09T00:00:00Z",
            status: "idle",
          },
          { hold: true },
        );
        attempt.ownershipSaved();
        if (entered) yield* Deferred.succeed(entered, undefined);
        if (gate) yield* Deferred.await(gate);
        yield* attempt.send(
          { ...refFor(sessionId), sessionScope: { kind: "repository" }, parts },
          parts,
        );
      }),
  });
  return {
    service,
    sends,
    sendOptions,
    reports,
    reported,
    stops,
    holds,
    failHoldRelease: () => {
      holdFailure = true;
    },
    failStop: () => {
      stopFailure = true;
    },
    setSendGate: (gate: Effect.Effect<void, HostOperationError>) => {
      sendGate = gate;
    },
    failBeforeNativeRequest: () => {
      issueSend = false;
    },
    failReport: () => {
      reportFailure = true;
    },
    hideReport: () => {
      reportVisible = false;
    },
  };
};

const yieldToFibers = Effect.gen(function* () {
  for (let index = 0; index < 20; index += 1) yield* Effect.yieldNow;
});

test.each([false, true])(
  "keeps command acceptance after update failure: %s",
  async (failUpdate) => {
    const accepted = { type: "command_accepted", commandName: "review" } as const;
    const h = fixture(accepted);
    if (failUpdate)
      h.setSendGate(
        Effect.fail(
          new AgentSessionCommandAcceptedError(
            { sessionRef: refFor("a-1"), acceptedCommand: accepted },
            new Error("Session update failed"),
          ),
        ),
      );
    const result = await Effect.runPromise(h.service.launch({ key: "a", sessionId: "a-1" }));
    expect(result.status).toBe(failUpdate ? "failed" : "completed");
    expect(result.acceptedMessage).toEqual(accepted);
    expect(result.unsentInstruction).toBeUndefined();
    expect(h.sends).toEqual(["a-1"]);
  },
);

test("launches with one key run in arrival order while another key runs at once", async () => {
  const h = fixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const first = yield* Effect.forkChild(
        h.service.launch({ key: "a", sessionId: "a-1", entered, gate }),
      );
      yield* Deferred.await(entered);
      const second = yield* Effect.forkChild(h.service.launch({ key: "a", sessionId: "a-2" }));
      // The other key completes while the first launch for key "a" still waits at its gate.
      const other = yield* h.service.launch({ key: "b", sessionId: "b-1" });
      expect(other.status).toBe("completed");
      expect(second.pollUnsafe()).toBeUndefined();
      expect(h.sends).toEqual(["b-1"]);
      yield* Deferred.succeed(gate, undefined);
      expect((yield* Fiber.join(first)).status).toBe("completed");
      expect((yield* Fiber.join(second)).status).toBe("completed");
    }),
  );
  expect(h.sends).toEqual(["b-1", "a-1", "a-2"]);
});

test("caller interruption does not stop the launch worker", async () => {
  const h = fixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const caller = yield* Effect.forkChild(
        h.service.launch({ key: "a", sessionId: "a-1", gate }),
      );
      yield* yieldToFibers;
      yield* Fiber.interrupt(caller);
      yield* Deferred.succeed(gate, undefined);
      // A later launch for the same key runs only after the first settles.
      yield* h.service.launch({ key: "a", sessionId: "a-2" });
    }),
  );
  expect(h.sends).toEqual(["a-1", "a-2"]);
  expect(h.holds).toEqual([
    ["a-1", true],
    ["a-1", false],
    ["a-2", true],
    ["a-2", false],
  ]);
});

test("a failed hold release fails an accepted launch as cleanup and keeps the accepted message", async () => {
  const h = fixture();
  h.failHoldRelease();
  const result = await Effect.runPromise(h.service.launch({ key: "a", sessionId: "a-1" }));
  expect(result).toMatchObject({
    status: "failed",
    session: { externalSessionId: "a-1" },
    acceptedMessage: { messageId: "message-1" },
    failure: { message: "Session launch cleanup failed.", cleanupErrors: ["Hold release failed"] },
  });
  expect(result.unsentInstruction).toBeUndefined();
});

test.each(["cancelSessionLaunches", "shutdown"] as const)(
  "%s cancels an active launch before its send",
  async (action) => {
    const h = fixture();
    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const launch = yield* Effect.forkChild(
          h.service.launch({ key: "a", sessionId: "a-1", gate }),
        );
        yield* yieldToFibers;
        if (action === "shutdown") yield* h.service.shutdown();
        else h.service.cancelSessionLaunches(refFor("a-1"));
        yield* Deferred.succeed(gate, undefined);
        const result = yield* Fiber.join(launch);
        expect(result).toMatchObject({
          status: "canceled",
          session: { externalSessionId: "a-1" },
          failure: { cleanupErrors: [] },
        });
        // Stop cancels at the next check. Shutdown interrupts the waiting worker.
        if (action === "cancelSessionLaunches")
          expect(result.failure?.message).toBe("Session launch was canceled.");
        expect(result.unsentInstruction).toBeUndefined();
      }),
    );
    expect(h.sends).toEqual([]);
    // Stop stops the native session after it cancels the launch. Shutdown leaves that to
    // settlement.
    expect(h.stops).toEqual(action === "shutdown" ? ["a-1"] : []);
  },
);

test("a launch that Stop cancels during an accepted send stops the session again", async () => {
  const h = fixture();
  h.failHoldRelease();
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      h.setSendGate(
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      );
      const launch = yield* Effect.forkChild(h.service.launch({ key: "a", sessionId: "a-1" }));
      yield* Deferred.await(entered);
      h.service.cancelSessionLaunches(refFor("a-1"));
      yield* Deferred.succeed(release, undefined);
      const result = yield* Fiber.join(launch);
      expect(result).toMatchObject({
        status: "canceled",
        acceptedMessage: { messageId: "message-1" },
        failure: {
          message: "Session launch cleanup failed.",
          cleanupErrors: ["Hold release failed"],
        },
      });
      expect(result.unsentInstruction).toBeUndefined();
    }),
  );
  // The native stop of the Stop command can come before the accepted turn starts.
  expect(h.stops).toEqual(["a-1"]);
});

test("a launch that Stop cancels before the send stops nothing itself", async () => {
  const h = fixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const launch = yield* Effect.forkChild(
        h.service.launch({ key: "a", sessionId: "a-1", gate }),
      );
      yield* yieldToFibers;
      h.service.cancelSessionLaunches(refFor("a-1"));
      yield* Deferred.succeed(gate, undefined);
      expect((yield* Fiber.join(launch)).status).toBe("canceled");
    }),
  );
  // The Stop command stops the native session, and the launch never sent to it.
  expect(h.sends).toEqual([]);
  expect(h.stops).toEqual([]);
});

test("a launch that shutdown cancels reports a failed stop of its created session", async () => {
  const h = fixture();
  h.failHoldRelease();
  h.failStop();
  await Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const launch = yield* Effect.forkChild(
        h.service.launch({ key: "a", sessionId: "a-1", gate }),
      );
      yield* yieldToFibers;
      yield* h.service.shutdown();
      const result = yield* Fiber.join(launch);
      expect(result.status).toBe("canceled");
      expect(result.failure?.cleanupErrors).toEqual(["Hold release failed", "Stop failed"]);
    }),
  );
  expect(h.sends).toEqual([]);
  expect(h.stops).toEqual(["a-1"]);
});

test("shutdown completes a launch whose worker has not started", async () => {
  const h = fixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      // The caller schedules the worker and then waits. Shutdown runs before the worker starts.
      const caller = yield* Effect.forkChild(h.service.launch({ key: "a", sessionId: "a-1" }), {
        startImmediately: true,
      });
      yield* h.service.shutdown();
      const exit = yield* Fiber.await(caller);
      expect(exit._tag).toBe("Failure");
    }),
  );
  expect(h.sends).toEqual([]);
});

test("the first instruction waits for native admission", async () => {
  const h = fixture();
  const result = await Effect.runPromise(h.service.launch({ key: "a", sessionId: "a-1" }));
  expect(result.status).toBe("completed");
  expect(h.sendOptions).toEqual([{ requireNativeAdmission: true, onSent: expect.any(Function) }]);
});

test("a failed launch shows its failure in the saved session for a caller that left", async () => {
  const h = fixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      h.setSendGate(
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(
            Effect.fail(
              new AgentSessionMessageRejectedError({
                operation: "send",
                message: "Runtime settings are invalid; fix the model.",
              }),
            ),
          ),
        ),
      );
      const caller = yield* Effect.forkChild(h.service.launch({ key: "a", sessionId: "a-1" }));
      yield* Deferred.await(entered);
      // The caller leaves. The host worker still settles the launch.
      yield* Fiber.interrupt(caller);
      yield* Deferred.succeed(release, undefined);
      yield* Deferred.await(h.reported);
    }),
  );
  expect(h.reports).toEqual([
    [
      "a-1",
      "The runtime did not accept the first instruction: Runtime settings are invalid; fix the model. Start the launch again or send a new message in this session.",
    ],
  ]);
});

test("a reported failure names its session notice, and a failed report keeps the failure without one", async () => {
  const rejected = new AgentSessionMessageRejectedError({ operation: "send", message: "No." });
  const h = fixture();
  h.setSendGate(Effect.fail(rejected));
  const result = await Effect.runPromise(h.service.launch({ key: "a", sessionId: "a-1" }));
  expect(result.failure).toEqual({ message: "No.", cleanupErrors: [], noticeId: "notice-1" });

  const unreported = fixture();
  unreported.setSendGate(Effect.fail(rejected));
  unreported.failReport();
  const hidden = await Effect.runPromise(unreported.service.launch({ key: "a", sessionId: "a-1" }));
  // Without a notice id, the caller must show the failure itself.
  expect(hidden.failure).toEqual({ message: "No.", cleanupErrors: ["Report failed"] });

  const detached = fixture();
  detached.setSendGate(Effect.fail(rejected));
  detached.hideReport();
  const unseen = await Effect.runPromise(detached.service.launch({ key: "a", sessionId: "a-1" }));
  // No live session showed the failure, so the result has no notice id and no cleanup error.
  expect(unseen.failure).toEqual({ message: "No.", cleanupErrors: [] });
});

test("a send failure without proof of rejection returns no instruction", async () => {
  const h = fixture();
  // A lost reply leaves the native admission unknown.
  h.setSendGate(
    Effect.fail(new HostOperationError({ operation: "send", message: "Request timed out." })),
  );
  const result = await Effect.runPromise(h.service.launch({ key: "a", sessionId: "a-1" }));
  expect(result).toMatchObject({
    status: "failed",
    session: { externalSessionId: "a-1" },
    failure: {
      message:
        "Request timed out. The runtime can have received the first instruction. Inspect the session before you send it again.",
      cleanupErrors: [],
    },
  });
  expect(result.unsentInstruction).toBeUndefined();
  expect(h.reports).toEqual([
    [
      "a-1",
      "The session launch failed: Request timed out. The runtime can have received the first instruction. Inspect the session before you send it again.",
    ],
  ]);
});

test("a send that fails before the native request returns the instruction", async () => {
  const h = fixture();
  h.failBeforeNativeRequest();
  h.setSendGate(
    Effect.fail(new HostOperationError({ operation: "send", message: "Runtime is stopping." })),
  );
  const result = await Effect.runPromise(h.service.launch({ key: "a", sessionId: "a-1" }));
  expect(result.status).toBe("failed");
  expect(result.failure?.message).toBe("Runtime is stopping.");
  expect(result.unsentInstruction).toEqual(parts);
});

test("a rejected send returns the instruction for a new send", async () => {
  const h = fixture();
  h.setSendGate(
    Effect.fail(
      new AgentSessionMessageRejectedError({ operation: "send", message: "Model removed." }),
    ),
  );
  const result = await Effect.runPromise(h.service.launch({ key: "a", sessionId: "a-1" }));
  expect(result.status).toBe("failed");
  expect(result.failure?.message).toBe("Model removed.");
  expect(result.unsentInstruction).toEqual(parts);
});

test("a completed launch reports nothing to the session", async () => {
  const h = fixture();
  await Effect.runPromise(h.service.launch({ key: "a", sessionId: "a-1" }));
  expect(h.reports).toEqual([]);
});
