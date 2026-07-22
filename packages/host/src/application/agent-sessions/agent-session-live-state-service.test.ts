import { describe, expect, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterPort,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import { createAgentSessionLiveStateService } from "./agent-session-live-state-service";

const sessionRef = (
  externalSessionId: string,
  runtimeKind: "codex" | "opencode" = "codex",
): AgentSessionLiveRef => ({
  repoPath: "/repo",
  runtimeKind,
  workingDirectory: `/repo/${externalSessionId}`,
  externalSessionId,
});

const liveSnapshot = (
  externalSessionId: string,
  runtimeKind: "codex" | "opencode" = "codex",
): AgentSessionLiveSnapshot => ({
  ref: sessionRef(externalSessionId, runtimeKind),
  activity: "idle",
  title: `Session ${externalSessionId}`,
  startedAt: "2026-07-16T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

const fakeAdapter = (input: {
  runtimeId: string;
  runtimeKind?: "codex" | "opencode";
  snapshots: () => ReadonlyArray<AgentSessionLiveSnapshot>;
  listEffect?: () => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  contextEffect?: AgentSessionLiveAdapterPort["loadContext"];
}): AgentSessionLiveAdapterPort => {
  const runtimeKind = input.runtimeKind ?? "codex";
  return {
    binding: { runtimeId: input.runtimeId, runtimeKind, repoPath: "/repo" },
    matches: (ref) =>
      input
        .snapshots()
        .some(
          (snapshot) =>
            snapshot.ref.runtimeKind === ref.runtimeKind &&
            snapshot.ref.externalSessionId === ref.externalSessionId &&
            snapshot.ref.workingDirectory === ref.workingDirectory &&
            snapshot.ref.repoPath === ref.repoPath,
        ),
    listRetainedSnapshots: () =>
      input.listEffect ? input.listEffect() : Effect.succeed(input.snapshots()),
    readRetainedSnapshot: (ref) => {
      const snapshot = input
        .snapshots()
        .find((candidate) => candidate.ref.externalSessionId === ref.externalSessionId);
      return Effect.succeed(
        snapshot ? { type: "live" as const, session: snapshot } : { type: "missing" as const, ref },
      );
    },
    loadContext: input.contextEffect ?? (() => Effect.succeed(null)),
    replyApproval: () => Effect.void,
    replyQuestion: () => Effect.void,
    releaseRuntime: () => Effect.succeed(input.snapshots().map((snapshot) => snapshot.ref)),
  };
};

const createHarness = () => {
  const events: AgentSessionLiveEnvelope[] = [];
  const faultLogs: string[] = [];
  const adapterRegistry = createLiveSessionAdapterRegistry();
  const service = createAgentSessionLiveStateService({
    adapterRegistry,
    faultLog: (message) => Effect.sync(() => faultLogs.push(message)),
    publish: (event) => events.push(event),
  });
  return { adapterRegistry, events, faultLogs, service };
};

const expectHostFailure = async <Success>(
  effect: Effect.Effect<Success, HostError>,
): Promise<HostError> => {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Right") {
    throw new Error("Expected effect to fail.");
  }
  return result.left;
};

describe("createAgentSessionLiveStateService", () => {
  test("publishes exactly one snapshot before a change queued during refresh", async () => {
    const { events, service } = createHarness();
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    let snapshots: ReadonlyArray<AgentSessionLiveSnapshot> = [liveSnapshot("session-1")];
    let listCallCount = 0;
    const adapter = fakeAdapter({
      runtimeId: "runtime-1",
      snapshots: () => snapshots,
      listEffect: () =>
        Effect.gen(function* () {
          listCallCount += 1;
          if (listCallCount === 1) {
            return snapshots;
          }
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          return snapshots;
        }),
    });
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));
    events.length = 0;

    const refreshFiber = Effect.runFork(service.refresh({ repoPath: "/repo" }));
    await Effect.runPromise(Deferred.await(entered));
    const updated = { ...liveSnapshot("session-1"), activity: "running" as const };
    const changeFiber = Effect.runFork(
      service.runAdapterMutation(
        Effect.sync(() => {
          snapshots = [updated];
          return {
            value: undefined,
            changes: [{ type: "session_upsert" as const, snapshot: updated }],
          };
        }),
      ),
    );

    await Effect.runPromise(Effect.yieldNow());
    expect(events).toEqual([]);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(refreshFiber));
    await Effect.runPromise(Fiber.join(changeFiber));

    expect(events.map((event) => event.type)).toEqual(["snapshot", "session_upsert"]);
    expect(events[0]).toMatchObject({
      type: "snapshot",
      repoPath: "/repo",
      sessions: [expect.objectContaining({ activity: "idle" })],
    });
    expect(events[1]).toMatchObject({
      type: "session_upsert",
      session: expect.objectContaining({ activity: "running" }),
    });
  });

  test("includes a completed mutation in the initial snapshot without replaying a duplicate", async () => {
    const { events, service } = createHarness();
    let snapshots: ReadonlyArray<AgentSessionLiveSnapshot> = [liveSnapshot("session-1")];
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({ runtimeId: "runtime-1", snapshots: () => snapshots }),
      ),
    );
    const updated = { ...liveSnapshot("session-1"), activity: "running" as const };
    await Effect.runPromise(
      service.runAdapterMutation(
        Effect.sync(() => {
          snapshots = [updated];
          return {
            value: undefined,
            changes: [{ type: "session_upsert" as const, snapshot: updated }],
          };
        }),
      ),
    );
    events.length = 0;

    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "snapshot",
      sessions: [expect.objectContaining({ activity: "running" })],
    });
  });

  test("publishes a resolution after an older refresh snapshot so it cannot resurrect pending input", async () => {
    const { events, service } = createHarness();
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const pending = {
      ...liveSnapshot("session-1"),
      activity: "waiting_for_permission" as const,
      pendingApprovals: [
        {
          requestId: "opaque-1",
          requestType: "command_execution" as const,
          title: "Run command",
        },
      ],
    };
    let snapshots: ReadonlyArray<AgentSessionLiveSnapshot> = [pending];
    let listCallCount = 0;
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-1",
          snapshots: () => snapshots,
          listEffect: () => {
            listCallCount += 1;
            if (listCallCount === 1) {
              return Effect.succeed(snapshots);
            }
            const refreshSnapshot = snapshots;
            return Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              return refreshSnapshot;
            });
          },
        }),
      ),
    );
    events.length = 0;

    const refreshFiber = Effect.runFork(service.refresh({ repoPath: "/repo" }));
    await Effect.runPromise(Deferred.await(entered));
    const resolved = {
      ...pending,
      activity: "idle" as const,
      pendingApprovals: [],
    };
    const resolutionFiber = Effect.runFork(
      service.runAdapterMutation(
        Effect.sync(() => {
          snapshots = [resolved];
          return {
            value: undefined,
            changes: [{ type: "session_upsert" as const, snapshot: resolved }],
          };
        }),
      ),
    );

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(refreshFiber));
    await Effect.runPromise(Fiber.join(resolutionFiber));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "snapshot",
      sessions: [
        expect.objectContaining({
          pendingApprovals: [
            {
              requestId: "opaque-1",
              requestType: "command_execution",
              title: "Run command",
            },
          ],
        }),
      ],
    });
    expect(events[1]).toMatchObject({
      type: "session_upsert",
      session: expect.objectContaining({ activity: "idle", pendingApprovals: [] }),
    });
  });

  test("orders a newer context notification after an older refresh snapshot", async () => {
    const { events, service } = createHarness();
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const retained = {
      ...liveSnapshot("session-1"),
      contextUsage: { totalTokens: 10 },
    };
    let snapshots: ReadonlyArray<AgentSessionLiveSnapshot> = [retained];
    let listCallCount = 0;
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-1",
          snapshots: () => snapshots,
          listEffect: () => {
            listCallCount += 1;
            if (listCallCount === 1) {
              return Effect.succeed(snapshots);
            }
            const refreshSnapshot = snapshots;
            return Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              return refreshSnapshot;
            });
          },
        }),
      ),
    );
    events.length = 0;

    const refreshFiber = Effect.runFork(service.refresh({ repoPath: "/repo" }));
    await Effect.runPromise(Deferred.await(entered));
    const updated = {
      ...retained,
      contextUsage: { totalTokens: 25 },
    };
    const contextFiber = Effect.runFork(
      service.runAdapterMutation(
        Effect.sync(() => {
          snapshots = [updated];
          return {
            value: undefined,
            changes: [{ type: "session_upsert" as const, snapshot: updated }],
          };
        }),
      ),
    );

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(refreshFiber));
    await Effect.runPromise(Fiber.join(contextFiber));

    expect(events[0]).toMatchObject({
      type: "snapshot",
      sessions: [expect.objectContaining({ contextUsage: { totalTokens: 10 } })],
    });
    expect(events[1]).toMatchObject({
      type: "session_upsert",
      session: expect.objectContaining({ contextUsage: { totalTokens: 25 } }),
    });
  });

  test("repeated refreshes do not multiply later delta publication", async () => {
    const { events, service } = createHarness();
    const initial: AgentSessionLiveSnapshot = {
      ...liveSnapshot("session-1"),
      contextUsage: { totalTokens: 42, contextWindow: 200_000 },
    };
    let snapshots: AgentSessionLiveSnapshot[] = [initial];
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({ runtimeId: "runtime-1", snapshots: () => snapshots }),
      ),
    );
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    events.length = 0;

    const updated: AgentSessionLiveSnapshot = { ...initial, activity: "running" };
    snapshots = [updated];
    await Effect.runPromise(
      service.runAdapterMutation(
        Effect.succeed({
          value: undefined,
          changes: [{ type: "session_upsert" as const, snapshot: updated }],
        }),
      ),
    );

    expect(events).toEqual([{ type: "session_upsert", session: updated }]);
  });

  test("publishes a scoped adapter fault with its exact live-session ref", async () => {
    const { events, faultLogs, service } = createHarness();
    const ref = sessionRef("session-1");

    await Effect.runPromise(
      service.runAdapterMutation(
        Effect.succeed({
          value: undefined,
          changes: [
            {
              type: "fault" as const,
              repoPath: "/repo",
              operation: "codex-live-session.process-event",
              message: "Codex event processing failed.",
              ref,
            },
          ],
        }),
      ),
    );

    expect(events).toEqual([
      {
        type: "fault",
        repoPath: "/repo",
        operation: "codex-live-session.process-event",
        message: "Codex event processing failed.",
        ref,
      },
    ]);
    expect(faultLogs).toEqual([
      'agent-session-live.fault {"repoPath":"/repo","message":"Codex event processing failed.","operation":"codex-live-session.process-event","runtimeKind":"codex","workingDirectory":"/repo/session-1","externalSessionId":"session-1"}',
    ]);
  });

  test("publishes an unscoped adapter fault without a live-session ref", async () => {
    const { events, faultLogs, service } = createHarness();

    await Effect.runPromise(
      service.runAdapterMutation(
        Effect.succeed({
          value: undefined,
          changes: [
            {
              type: "fault" as const,
              repoPath: "/repo",
              operation: "codex-live-session.process-event",
              message: "Codex event processing failed before routing.",
            },
          ],
        }),
      ),
    );

    expect(events).toEqual([
      {
        type: "fault",
        repoPath: "/repo",
        operation: "codex-live-session.process-event",
        message: "Codex event processing failed before routing.",
      },
    ]);
    expect(faultLogs).toEqual([
      'agent-session-live.fault {"repoPath":"/repo","message":"Codex event processing failed before routing.","operation":"codex-live-session.process-event"}',
    ]);
  });

  test("publishes a fault envelope when mandatory fault logging fails", async () => {
    const events: AgentSessionLiveEnvelope[] = [];
    let logAttempts = 0;
    const logFailure = new HostOperationError({
      operation: "test.fault-log",
      message: "fault logging failed",
    });
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () =>
        Effect.sync(() => {
          logAttempts += 1;
        }).pipe(Effect.zipRight(Effect.fail(logFailure))),
      publish: (event) => events.push(event),
    });

    const failure = await expectHostFailure(
      service.runAdapterMutation(
        Effect.succeed({
          value: undefined,
          changes: [
            {
              type: "fault" as const,
              repoPath: "/repo",
              message: "Codex event processing failed.",
            },
          ],
        }),
      ),
    );

    expect(failure).toBe(logFailure);
    expect(logAttempts).toBe(1);
    expect(events).toEqual([
      {
        type: "fault",
        repoPath: "/repo",
        message: "Codex event processing failed.",
      },
    ]);
  });

  test("publishes later changes after a fault logging failure before returning it", async () => {
    const events: AgentSessionLiveEnvelope[] = [];
    const logFailure = new HostOperationError({
      operation: "test.fault-log",
      message: "fault logging failed",
    });
    const snapshot = liveSnapshot("session-1");
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.fail(logFailure),
      publish: (event) => events.push(event),
    });

    const failure = await expectHostFailure(
      service.runAdapterMutation(
        Effect.succeed({
          value: undefined,
          changes: [
            {
              type: "fault" as const,
              repoPath: "/repo",
              message: "Codex event processing failed.",
            },
            { type: "session_upsert" as const, snapshot },
          ],
        }),
      ),
    );

    expect(failure).toBe(logFailure);
    expect(events).toEqual([
      {
        type: "fault",
        repoPath: "/repo",
        message: "Codex event processing failed.",
      },
      { type: "session_upsert", session: snapshot },
    ]);
  });

  test("attempts mandatory fault logging when fault envelope publication fails", async () => {
    let logAttempts = 0;
    let publishAttempts = 0;
    const publishFailure = new HostOperationError({
      operation: "test.publish",
      message: "fault publication failed",
    });
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () =>
        Effect.sync(() => {
          logAttempts += 1;
        }),
      publish: () => {
        publishAttempts += 1;
        throw publishFailure;
      },
    });

    const failure = await expectHostFailure(
      service.runAdapterMutation(
        Effect.succeed({
          value: undefined,
          changes: [
            {
              type: "fault" as const,
              repoPath: "/repo",
              message: "Codex event processing failed.",
            },
          ],
        }),
      ),
    );

    expect(failure).toBe(publishFailure);
    expect(logAttempts).toBe(1);
    expect(publishAttempts).toBe(1);
  });

  test("stops later changes when fault envelope publication fails", async () => {
    const published: AgentSessionLiveEnvelope[] = [];
    const publishFailure = new HostOperationError({
      operation: "test.publish",
      message: "fault publication failed",
    });
    const snapshot = liveSnapshot("session-1");
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      publish: (event) => {
        published.push(event);
        if (event.type === "fault") {
          throw publishFailure;
        }
      },
    });

    const failure = await expectHostFailure(
      service.runAdapterMutation(
        Effect.succeed({
          value: undefined,
          changes: [
            {
              type: "fault" as const,
              repoPath: "/repo",
              message: "Codex event processing failed.",
            },
            { type: "session_upsert" as const, snapshot },
          ],
        }),
      ),
    );

    expect(failure).toBe(publishFailure);
    expect(published).toEqual([
      {
        type: "fault",
        repoPath: "/repo",
        message: "Codex event processing failed.",
      },
    ]);
  });

  test("reports both failures when fault logging and publication fail", async () => {
    let logAttempts = 0;
    let publishAttempts = 0;
    const logFailure = new HostOperationError({
      operation: "test.fault-log",
      message: "fault logging failed",
    });
    const publishFailure = new HostOperationError({
      operation: "test.publish",
      message: "fault publication failed",
    });
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () =>
        Effect.sync(() => {
          logAttempts += 1;
        }).pipe(Effect.zipRight(Effect.fail(logFailure))),
      publish: () => {
        publishAttempts += 1;
        throw publishFailure;
      },
    });

    const failure = await expectHostFailure(
      service.runAdapterMutation(
        Effect.succeed({
          value: undefined,
          changes: [
            {
              type: "fault" as const,
              repoPath: "/repo",
              message: "Codex event processing failed.",
            },
          ],
        }),
      ),
    );

    expect(logAttempts).toBe(1);
    expect(publishAttempts).toBe(1);
    expect(failure.message).toContain("fault logging failed");
    expect(failure.message).toContain("fault publication failed");
    expect(failure).toMatchObject({
      _tag: "HostOperationError",
      operation: "agent-session-live.publish-fault",
      message: expect.stringContaining("fault logging failed"),
      details: {
        faultLogFailure: logFailure,
        publishFailure,
      },
      cause: {
        faultLogFailure: logFailure,
        publishFailure,
      },
    });
  });

  test("does not log ordinary live-session envelopes", async () => {
    const { events, faultLogs, service } = createHarness();

    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    expect(events).toEqual([{ type: "snapshot", repoPath: "/repo", sessions: [] }]);
    expect(faultLogs).toEqual([]);
  });

  test("context failure does not make retained pending/session state unreadable", async () => {
    const { events, service } = createHarness();
    const snapshot = liveSnapshot("session-1");
    const adapter = fakeAdapter({
      runtimeId: "runtime-1",
      snapshots: () => [snapshot],
      contextEffect: () =>
        Effect.fail(
          new HostOperationError({
            operation: "agent-session-live.load-context",
            message: "context replay failed",
          }),
        ),
    });
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));
    events.length = 0;

    await expect(Effect.runPromise(service.loadContext(snapshot.ref))).rejects.toThrow(
      "context replay failed",
    );
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    expect(events[0]).toMatchObject({
      type: "snapshot",
      sessions: [expect.objectContaining({ ref: snapshot.ref })],
    });
  });

  test("fails context loading when repository/runtime scope is ambiguous", async () => {
    const { service } = createHarness();
    const first = liveSnapshot("session-1");
    const second = liveSnapshot("session-2");
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-1",
          snapshots: () => [first],
          contextEffect: () => Effect.succeed({ totalTokens: 10 }),
        }),
      ),
    );
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-2",
          snapshots: () => [second],
          contextEffect: () => Effect.succeed({ totalTokens: 20 }),
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        service.loadContext({
          ...first.ref,
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ),
    ).rejects.toThrow("Multiple live runtimes match");
  });

  test("a blocked explicit context load does not delay snapshot or pending hydration", async () => {
    const { events, service } = createHarness();
    const contextStarted = await Effect.runPromise(Deferred.make<void>());
    const releaseContext = await Effect.runPromise(Deferred.make<void>());
    const snapshot = {
      ...liveSnapshot("session-1"),
      activity: "waiting_for_permission" as const,
      pendingApprovals: [
        {
          requestId: "opaque-1",
          requestType: "command_execution" as const,
          title: "Run command",
        },
      ],
    };
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-1",
          snapshots: () => [snapshot],
          contextEffect: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(contextStarted, undefined);
              yield* Deferred.await(releaseContext);
              return { totalTokens: 42 };
            }),
        }),
      ),
    );
    events.length = 0;

    const contextFiber = Effect.runFork(service.loadContext(snapshot.ref));
    await Effect.runPromise(Deferred.await(contextStarted));
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    expect(events[0]).toMatchObject({
      type: "snapshot",
      sessions: [
        expect.objectContaining({
          pendingApprovals: [expect.objectContaining({ requestId: "opaque-1" })],
        }),
      ],
    });
    await Effect.runPromise(Deferred.succeed(releaseContext, undefined));
    await expect(Effect.runPromise(Fiber.join(contextFiber))).resolves.toEqual({ totalTokens: 42 });
  });

  test("rejects malformed adapter snapshots before publishing them", async () => {
    const { events, service } = createHarness();
    const malformed = {
      ...liveSnapshot("session-1"),
      startedAt: "not-an-iso-timestamp",
    } as AgentSessionLiveSnapshot;

    await expect(
      Effect.runPromise(
        service.registerRuntimeAdapter(
          fakeAdapter({ runtimeId: "runtime-1", snapshots: () => [malformed] }),
        ),
      ),
    ).rejects.toThrow();
    expect(events).toEqual([]);
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([]);
  });

  test("keeps the registered runtime when a duplicate registration is rejected", async () => {
    const { service } = createHarness();
    const retained = liveSnapshot("original-session");
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({ runtimeId: "runtime-1", snapshots: () => [retained] }),
      ),
    );

    await expect(
      Effect.runPromise(
        service.registerRuntimeAdapter(
          fakeAdapter({
            runtimeId: "runtime-1",
            snapshots: () => [liveSnapshot("duplicate-session")],
          }),
        ),
      ),
    ).rejects.toThrow("already registered");

    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([
      retained,
    ]);
  });

  test("runtime release removes only that runtime's sessions", async () => {
    const { events, service } = createHarness();
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({ runtimeId: "runtime-1", snapshots: () => [liveSnapshot("codex-1")] }),
      ),
    );
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-2",
          runtimeKind: "opencode",
          snapshots: () => [liveSnapshot("opencode-1", "opencode")],
        }),
      ),
    );
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    await Effect.runPromise(service.releaseRuntime("runtime-1"));

    expect(events.at(-1)).toMatchObject({
      type: "session_removed",
      ref: expect.objectContaining({ externalSessionId: "codex-1" }),
    });
    const retained = await Effect.runPromise(service.list({ repoPath: "/repo" }));
    expect(retained.map((entry) => entry.ref.externalSessionId)).toEqual(["opencode-1"]);
  });

  test("releases adapter state and removes sessions when the final retained read fails", async () => {
    const { events, service } = createHarness();
    const snapshot = liveSnapshot("session-1");
    let failRetainedRead = false;
    let releaseCalled = false;
    const adapter = {
      ...fakeAdapter({
        runtimeId: "runtime-1",
        snapshots: () => [snapshot],
        listEffect: () =>
          failRetainedRead
            ? Effect.fail(
                new HostOperationError({
                  operation: "test.list-retained",
                  message: "retained snapshot read failed",
                }),
              )
            : Effect.succeed([snapshot]),
      }),
      releaseRuntime: () =>
        Effect.sync(() => {
          releaseCalled = true;
          return [snapshot.ref];
        }),
    } satisfies AgentSessionLiveAdapterPort;
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    failRetainedRead = true;

    await expect(Effect.runPromise(service.releaseRuntime("runtime-1"))).rejects.toThrow(
      "retained snapshot read failed",
    );

    expect(releaseCalled).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "session_removed", ref: snapshot.ref });
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([]);
  });

  test("publishes an authoritative snapshot when retained reads and cleanup both fail", async () => {
    const { events, service } = createHarness();
    const snapshot = liveSnapshot("session-1");
    let failRetainedRead = false;
    const adapter = {
      ...fakeAdapter({
        runtimeId: "runtime-1",
        snapshots: () => [snapshot],
        listEffect: () =>
          failRetainedRead
            ? Effect.fail(
                new HostOperationError({
                  operation: "test.list-retained",
                  message: "retained snapshot read failed",
                }),
              )
            : Effect.succeed([snapshot]),
      }),
      releaseRuntime: () =>
        Effect.fail(
          new HostOperationError({
            operation: "test.release-runtime",
            message: "adapter cleanup failed",
          }),
        ),
    } satisfies AgentSessionLiveAdapterPort;
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));
    failRetainedRead = true;
    events.length = 0;

    await expect(Effect.runPromise(service.releaseRuntime("runtime-1"))).rejects.toThrow(
      "retained snapshot read failed",
    );

    expect(events).toEqual([{ type: "snapshot", repoPath: "/repo", sessions: [] }]);
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([]);
  });

  test("routes an unloaded session resume through the repository runtime scope", async () => {
    const { service } = createHarness();
    const summary = {
      externalSessionId: "persisted-session",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/persisted-session",
      role: "build" as const,
      startedAt: "2026-07-16T10:00:00.000Z",
      status: "idle" as const,
    };
    let resumeInput: unknown;
    const adapter = {
      ...fakeAdapter({
        runtimeId: "runtime-1",
        runtimeKind: "opencode",
        snapshots: () => [],
      }),
      startSession: () => Effect.dieMessage("unexpected start"),
      resumeSession: (input) =>
        Effect.sync(() => {
          resumeInput = input;
          return summary;
        }),
      forkSession: () => Effect.dieMessage("unexpected fork"),
      sendUserMessage: () => Effect.dieMessage("unexpected send"),
      updateSessionModel: () => Effect.dieMessage("unexpected model update"),
      stopSession: () => Effect.dieMessage("unexpected stop"),
      releaseSession: () => Effect.dieMessage("unexpected release"),
    } satisfies AgentSessionRuntimeAdapterPort;
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));

    const input = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/persisted-session",
      externalSessionId: "persisted-session",
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
    };

    await expect(Effect.runPromise(service.resumeSession(input))).resolves.toEqual(summary);
    expect(resumeInput).toEqual(input);
  });

  test("routes an unloaded Codex session send through the repository runtime scope", async () => {
    const { service } = createHarness();
    let sendInput: unknown;
    const accepted = {
      type: "user_message" as const,
      externalSessionId: "persisted-session",
      timestamp: "2026-07-16T10:02:00.000Z",
      messageId: "message-1",
      message: "Continue",
      parts: [{ kind: "text" as const, text: "Continue" }],
      state: "queued" as const,
    };
    const adapter = {
      ...fakeAdapter({
        runtimeId: "runtime-1",
        snapshots: () => [],
      }),
      startSession: () => Effect.dieMessage("unexpected start"),
      resumeSession: () => Effect.dieMessage("unexpected resume"),
      forkSession: () => Effect.dieMessage("unexpected fork"),
      sendUserMessage: (input) =>
        Effect.sync(() => {
          sendInput = input;
          return accepted;
        }),
      updateSessionModel: () => Effect.dieMessage("unexpected model update"),
      stopSession: () => Effect.dieMessage("unexpected stop"),
      releaseSession: () => Effect.dieMessage("unexpected release"),
    } satisfies AgentSessionRuntimeAdapterPort;
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));
    const input = {
      ...sessionRef("persisted-session"),
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
      parts: [{ kind: "text" as const, text: "Continue" }],
    };

    await expect(Effect.runPromise(service.sendUserMessage(input))).resolves.toEqual(accepted);
    expect(sendInput).toEqual(input);
  });
});
