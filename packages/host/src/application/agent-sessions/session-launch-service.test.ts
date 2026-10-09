import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import type { AgentSessionControlSendInput, SessionLaunchState } from "@openducktor/contracts";
import { HostOperationError } from "../../effect/host-errors";
import { AgentSessionMessageRejectedError } from "../../ports/agent-session-send-error";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";
import { createSessionLaunchService } from "./session-launch-service";
import type { SessionLaunchContext, SessionLaunchRef } from "./session-launch-types";

const fixture = () => {
  const request: SessionLaunchRef = {
    workspaceId: "workspace",
    repoPath: "/repo",
    launchAttemptId: "attempt",
  };
  const session = {
    externalSessionId: "session",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo",
    startedAt: "2026-10-09T00:00:00Z",
    status: "idle" as const,
  };
  const input: AgentSessionControlSendInput = {
    repoPath: "/repo",
    ...session,
    sessionScope: { kind: "repository" },
    parts: [{ kind: "text", text: "Retained instruction" }],
  };
  const entered = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  let failure: "rejected" | "unknown" | undefined;
  const sends: AgentSessionControlSendInput[] = [];
  let context!: SessionLaunchContext<SessionLaunchRef, SessionLaunchState>;
  const runtime: SessionLaunchRuntimePort = {
    read: (ref) => Effect.succeed({ type: "missing", ref }),
    holdWorkflowLaunch: () => Effect.void,
    stopSession: () => Effect.void,
    sendUserMessage: (sent) =>
      Effect.gen(function* () {
        sends.push(sent);
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        if (failure === "rejected")
          return yield* new AgentSessionMessageRejectedError({
            operation: "send",
            message: "Rejected",
          });
        if (failure === "unknown")
          return yield* new HostOperationError({ operation: "send", message: "Connection lost" });
        return {
          type: "user_message",
          externalSessionId: "session",
          messageId: "message",
          message: "Retained instruction",
          parts: [{ kind: "text", text: "Retained instruction" }],
          timestamp: session.startedAt,
          state: "read",
        };
      }),
  };
  const service = createSessionLaunchService<
    SessionLaunchRef,
    SessionLaunchState,
    SessionLaunchRef,
    SessionLaunchRef
  >({
    runtime,
    publish: () => Effect.void,
    initial: (ref) => ({
      snapshot: { ...ref, phase: "queued", acceptance: "not_submitted", ownershipSaved: false },
    }),
    key: (ref) => ref.workspaceId,
    queue: () => false,
    matches: (saved, ref) => saved.workspaceId === ref.workspaceId,
    includes: () => true,
    validateRead: () => Effect.void,
    run: (attempt) => {
      context = attempt;
      attempt.retainSession(session);
      attempt.ownershipSaved();
      attempt.retainInstruction(input);
      return attempt.withSession(attempt.send(runtime.sendUserMessage));
    },
    recover: (attempt) => attempt.withSession(attempt.send(runtime.sendUserMessage)),
  });
  return {
    service,
    request,
    input,
    entered,
    release,
    sends,
    context: () => context,
    setFailure: (value: typeof failure) => {
      failure = value;
    },
  };
};

test.each(["accepted", "unknown"] as const)(
  "launch keeps pending input and releases it after %s acceptance",
  async (acceptance) => {
    const h = fixture();
    if (acceptance === "unknown") h.setFailure("unknown");
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const worker = yield* Effect.forkChild(h.service.launch(h.request));
          yield* Deferred.await(h.entered);
          expect(h.context().sendInput).toEqual(h.input);
          yield* Deferred.succeed(h.release, undefined);
          const result = yield* Fiber.join(worker);
          expect(result.acceptance).toBe(acceptance);
          expect(h.context().sendInput).toBeUndefined();
          expect(yield* h.service.launch(h.request)).toEqual(result);
          expect(h.sends).toHaveLength(1);
        }),
      ),
    );
  },
);

test("recovery retains its rejected input until native acceptance", async () => {
  const h = fixture();
  h.setFailure("rejected");
  await Effect.runPromise(Deferred.succeed(h.release, undefined));
  const failed = await Effect.runPromise(h.service.launch(h.request));
  expect(failed.recoveryAllowed).toBe(true);
  expect(h.context().sendInput).toEqual(h.input);
  h.setFailure(undefined);
  const recovered = await Effect.runPromise(h.service.recover(h.request));
  expect(recovered.acceptance).toBe("accepted");
  expect(h.sends).toEqual([h.input, h.input]);
  expect(h.context().sendInput).toBeUndefined();
});

test.each(["cancel", "stop", "send", "shutdown"] as const)(
  "%s releases input when rejected launch recovery ends",
  async (action) => {
    const h = fixture();
    h.setFailure("rejected");
    await Effect.runPromise(Deferred.succeed(h.release, undefined));
    await Effect.runPromise(h.service.launch(h.request));
    expect(h.context().sendInput).toEqual(h.input);
    const operations = {
      cancel: () => h.service.cancel(h.request).pipe(Effect.asVoid),
      stop: () => h.service.cancelSessionBeforeStop(h.input),
      send: () => h.service.cancelRecoveryBeforeSend(h.input),
      shutdown: () => h.service.shutdown(),
    };
    await Effect.runPromise(operations[action]());
    expect(h.context().sendInput).toBeUndefined();
    expect((await Effect.runPromise(h.service.read(h.request)))[0]?.recoveryAllowed).toBe(false);
    await expect(Effect.runPromise(h.service.recover(h.request))).rejects.toThrow(
      "recovery is unavailable",
    );
    expect(h.sends).toHaveLength(1);
  },
);
