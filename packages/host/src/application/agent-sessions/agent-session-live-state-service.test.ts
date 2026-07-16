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
  const adapterRegistry = createLiveSessionAdapterRegistry();
  const service = createAgentSessionLiveStateService({
    adapterRegistry,
    publish: (event) => events.push(event),
  });
  return { adapterRegistry, events, service };
};

describe("createAgentSessionLiveStateService", () => {
  test("publishes exactly one snapshot before a change queued during attachment", async () => {
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

    const attachFiber = Effect.runFork(
      service.attach({ attachmentId: "attachment-1", repoPath: "/repo" }),
    );
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
    await Effect.runPromise(Fiber.join(attachFiber));
    await Effect.runPromise(Fiber.join(changeFiber));

    expect(events.map((event) => event.type)).toEqual(["snapshot", "session_upsert"]);
    expect(events[0]).toMatchObject({
      type: "snapshot",
      attachmentId: "attachment-1",
      sessions: [expect.objectContaining({ activity: "idle" })],
    });
    expect(events[1]).toMatchObject({
      type: "session_upsert",
      attachmentId: "attachment-1",
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

    await Effect.runPromise(service.attach({ attachmentId: "attachment-1", repoPath: "/repo" }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "snapshot",
      sessions: [expect.objectContaining({ activity: "running" })],
    });
  });

  test("publishes a resolution after an older attachment snapshot so it cannot resurrect pending input", async () => {
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
            const attachmentSnapshot = snapshots;
            return Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              return attachmentSnapshot;
            });
          },
        }),
      ),
    );

    const attachFiber = Effect.runFork(
      service.attach({ attachmentId: "attachment-1", repoPath: "/repo" }),
    );
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
    await Effect.runPromise(Fiber.join(attachFiber));
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

  test("orders a newer context notification after an older attachment snapshot", async () => {
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
            const attachmentSnapshot = snapshots;
            return Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              return attachmentSnapshot;
            });
          },
        }),
      ),
    );

    const attachFiber = Effect.runFork(
      service.attach({ attachmentId: "attachment-1", repoPath: "/repo" }),
    );
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
    await Effect.runPromise(Fiber.join(attachFiber));
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

  test("renderer detach preserves retained runtime state for the next attachment", async () => {
    const { events, service } = createHarness();
    const snapshots = [
      {
        ...liveSnapshot("session-1"),
        contextUsage: { totalTokens: 42, contextWindow: 200_000 },
      },
    ];
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({ runtimeId: "runtime-1", snapshots: () => snapshots }),
      ),
    );
    await Effect.runPromise(service.attach({ attachmentId: "first", repoPath: "/repo" }));
    await Effect.runPromise(service.detach({ attachmentId: "first" }));
    await Effect.runPromise(service.attach({ attachmentId: "second", repoPath: "/repo" }));

    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe("snapshot");
    if (events[1]?.type !== "snapshot") {
      throw new Error("Expected the second attachment snapshot.");
    }
    expect(events[1].attachmentId).toBe("second");
    expect(events[1].sessions[0]?.contextUsage?.totalTokens).toBe(42);
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

    await expect(Effect.runPromise(service.loadContext(snapshot.ref))).rejects.toThrow(
      "context replay failed",
    );
    await Effect.runPromise(service.attach({ attachmentId: "attachment-1", repoPath: "/repo" }));

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

    const contextFiber = Effect.runFork(service.loadContext(snapshot.ref));
    await Effect.runPromise(Deferred.await(contextStarted));
    await Effect.runPromise(service.attach({ attachmentId: "attachment-1", repoPath: "/repo" }));

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
    await Effect.runPromise(service.attach({ attachmentId: "attachment-1", repoPath: "/repo" }));

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
    await Effect.runPromise(service.attach({ attachmentId: "attachment-1", repoPath: "/repo" }));
    failRetainedRead = true;

    await expect(Effect.runPromise(service.releaseRuntime("runtime-1"))).rejects.toThrow(
      "retained snapshot read failed",
    );

    expect(releaseCalled).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "session_removed", ref: snapshot.ref });
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
});
