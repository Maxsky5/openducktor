import { unexpectedSessionImport } from "../../test-support/session-import-test-doubles";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import { describe, expect, test } from "bun:test";
import type {
  AgentSessionControlUpdateTitleInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  RuntimeKind,
} from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { type HostError, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterMutation,
  AgentSessionRuntimeAdapterPort,
  AgentSessionTitleUpdateOutcome,
} from "../../ports/agent-session-live-adapter-port";
import { createAgentSessionLiveStateService } from "./agent-session-live-state-service";
import { createSessionOccurrenceProjector } from "../notifications/session-occurrence-projector";
import type { WithProcessStartAdmission } from "../workspaces/workspace-admission-service";
import type { RuntimeAdmissionPort } from "../../ports/runtime-admission-port";

const passThroughAdmission: RuntimeAdmissionPort = { admit: (_runtimeKind, effect) => effect };

const sessionRef = (
  externalSessionId: string,
  runtimeKind: RuntimeKind = "codex",
): AgentSessionLiveRef => ({
  repoPath: "/repo",
  runtimeKind,
  workingDirectory: `/repo/${externalSessionId}`,
  externalSessionId,
});

const liveSnapshot = (
  externalSessionId: string,
  runtimeKind: RuntimeKind = "codex",
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
  runtimeKind?: RuntimeKind;
  snapshots: () => ReadonlyArray<AgentSessionLiveSnapshot>;
  refreshEffect?: () => Effect.Effect<void, HostError>;
  listEffect?: () => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  contextEffect?: AgentSessionLiveAdapterPort["loadContext"];
}): AgentSessionLiveAdapterPort => {
  const runtimeKind = input.runtimeKind ?? "codex";
  const refreshSnapshots = input.refreshEffect
    ? { refreshSnapshots: () => input.refreshEffect?.() ?? Effect.void }
    : {};
  const adapter = {
    queries: unexpectedRuntimeQueries,
    sessionImport: unexpectedSessionImport,
    supportsSessionControl: false,
    beginGeneratedImageBatch: () => Effect.die(new Error("Unexpected beginGeneratedImageBatch")),
    releaseGeneratedImageBatch: () =>
      Effect.die(new Error("Unexpected releaseGeneratedImageBatch")),
    describeGeneratedImages: () => Effect.die(new Error("Unexpected describeGeneratedImages")),
    resolveGeneratedImageSource: () => Effect.die(new Error("Unexpected generated image read")),
    binding: new AgentSessionLiveRegistration(
      { runtimeId: input.runtimeId, runtimeKind },
      (mutation) => Effect.map(mutation, ({ value }) => value),
    ),
    ...refreshSnapshots,
    listSnapshots: () =>
      input.listEffect ? input.listEffect() : Effect.succeed(input.snapshots()),
    readSnapshot: (ref) => {
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
  } satisfies AgentSessionLiveAdapterPort;
  return adapter;
};

const titleControlAdapter = (
  updateTitle: (
    input: AgentSessionControlUpdateTitleInput,
  ) => Effect.Effect<AgentSessionTitleUpdateOutcome, HostError>,
): AgentSessionRuntimeAdapterPort => ({
  ...fakeAdapter({ runtimeId: "runtime-1", snapshots: () => [liveSnapshot("session-1")] }),
  queries: unexpectedRuntimeQueries,
  supportsSessionControl: true,
  startSession: () => Effect.die(new Error("unexpected start")),
  resumeSession: () => Effect.die(new Error("unexpected resume")),
  continueInterruptedTurn: () => Effect.die(new Error("unexpected continue")),
  forkSession: () => Effect.die(new Error("unexpected fork")),
  sendUserMessage: () => Effect.die(new Error("unexpected send")),
  updateSessionModel: () => Effect.die(new Error("unexpected model update")),
  updateSessionTitle: updateTitle,
  stopSession: () => Effect.die(new Error("unexpected stop")),
  releaseSession: () => Effect.die(new Error("unexpected release")),
});

const mutationRegistrations = new WeakMap<
  ReturnType<typeof createAgentSessionLiveStateService>,
  AgentSessionLiveRegistration
>();
const mutateRegisteredAdapter = <A>(
  service: ReturnType<typeof createAgentSessionLiveStateService>,
  mutation: Effect.Effect<AgentSessionLiveAdapterMutation<A>, HostError>,
): Effect.Effect<A, HostError> =>
  Effect.gen(function* () {
    let registration = mutationRegistrations.get(service);
    if (!registration) {
      registration = service.createRuntimeRegistration({
        runtimeId: "runtime-test",
        runtimeKind: "opencode",
      });
      yield* service.registerRuntimeAdapter({
        ...fakeAdapter({ runtimeId: "runtime-test", runtimeKind: "opencode", snapshots: () => [] }),
        binding: registration,
      });
      mutationRegistrations.set(service, registration);
    }
    return yield* registration.runMutation(mutation);
  });

const createHarness = (withProcessStartAdmission?: WithProcessStartAdmission) => {
  const events: AgentSessionLiveEnvelope[] = [];
  const faultLogs: string[] = [];
  const adapterRegistry = createLiveSessionAdapterRegistry();
  const service = createAgentSessionLiveStateService({
    runtimeAdmission: passThroughAdmission,
    adapterRegistry,
    withProcessStartAdmission,
    faultLog: (message) => Effect.sync(() => faultLogs.push(message)),
    publish: (event) => events.push(event),
  });
  return { adapterRegistry, events, faultLogs, service };
};

const expectHostFailure = async <Success>(
  effect: Effect.Effect<Success, HostError>,
): Promise<HostError> => {
  const result = await Effect.runPromise(Effect.result(effect));
  if (result._tag === "Success") {
    throw new Error("Expected effect to fail.");
  }
  return result.failure;
};

test.each(["runtime", "session"] as const)(
  "clears a starting hold after %s removal even when fault reporting fails",
  async (removal) => {
    let failPublication = false;
    const adapterRegistry = createLiveSessionAdapterRegistry();
    const service = createAgentSessionLiveStateService({
      runtimeAdmission: passThroughAdmission,
      adapterRegistry,
      publish: () => {
        if (failPublication) throw new Error("Publication failed");
      },
      faultLog: () =>
        Effect.fail(new HostOperationError({ operation: "log", message: "Log failed" })),
    });
    const binding = service.createRuntimeRegistration({
      runtimeId: "old",
      runtimeKind: "codex",
    });
    const old = {
      ...fakeAdapter({ runtimeId: "old", snapshots: () => [liveSnapshot("session-1")] }),
      binding,
    };
    await Effect.runPromise(service.registerRuntimeAdapter(old));
    await Effect.runPromise(service.holdWorkflowLaunch(sessionRef("session-1"), true));
    failPublication = true;
    await Effect.runPromise(
      Effect.result(
        removal === "runtime"
          ? service.releaseRuntime("old")
          : binding.runMutation(
              Effect.succeed({
                value: undefined,
                changes: [
                  { type: "fault", repoPath: "/repo", message: "Earlier native fault" },
                  { type: "session_removed", ref: sessionRef("session-1") },
                ],
              }),
            ),
      ),
    );
    failPublication = false;
    if (removal === "runtime")
      await Effect.runPromise(
        service.registerRuntimeAdapter(
          fakeAdapter({
            runtimeId: "replacement",
            snapshots: () => [liveSnapshot("session-1")],
          }),
        ),
      );
    const observed = await Effect.runPromise(service.read(sessionRef("session-1")));
    expect(observed.type).toBe("live");
    if (observed.type === "live") expect(observed.session.activity).toBe("idle");
  },
);

test.each(["session_idle", "session_status", "session_finished"] as const)(
  "defers held %s signals until native idle is confirmed",
  async (type) => {
    for (const releaseActivity of ["idle", "running", "waiting_for_permission"] as const) {
      const occurrences: string[] = [];
      const envelopes: AgentSessionLiveEnvelope[] = [];
      const projector = createSessionOccurrenceProjector({
        repositoryLabel: "Repo",
        resolveAssociation: () => ({ kind: "workflow", taskId: "task-1", role: "build" }),
        resolveTask: (id) => ({ id, title: "Task" }),
      });
      let current = liveSnapshot("held");
      const service = createAgentSessionLiveStateService({
        runtimeAdmission: passThroughAdmission,
        adapterRegistry: createLiveSessionAdapterRegistry(),
        faultLog: () => Effect.void,
        publish: (envelope) => envelopes.push(envelope),
        observeNotificationInput: (envelope, provenance) => {
          occurrences.push(...projector.accept(envelope, provenance).map((notice) => notice.kind));
        },
      });
      const binding = service.createRuntimeRegistration({
        runtimeId: "held-runtime",
        runtimeKind: "codex",
      });
      await Effect.runPromise(
        service.registerRuntimeAdapter({
          ...fakeAdapter({ runtimeId: "held-runtime", snapshots: () => [current] }),
          binding,
        }),
      );
      await Effect.runPromise(service.holdWorkflowLaunch(current.ref, true));
      const initial = await Effect.runPromise(service.read(current.ref));
      const base = {
        sessionRef: current.ref,
        externalSessionId: current.ref.externalSessionId,
        timestamp: "2026-10-04T00:00:01.000Z",
      };
      const event: AgentSessionTranscriptEvent =
        type === "session_status"
          ? { ...base, type, status: { type: "idle" } }
          : type === "session_finished"
            ? { ...base, type, message: "Finished" }
            : { ...base, type, turnCompleted: true };
      const idleStatus: AgentSessionTranscriptEvent = {
        ...base,
        type: "session_status",
        status: { type: "idle" },
      };
      await Effect.runPromise(
        binding.runMutation(
          Effect.succeed({
            value: undefined,
            changes: [
              { type: "transcript_event" as const, event },
              { type: "session_upsert" as const, snapshot: current },
            ],
          }),
        ),
      );
      if (type === "session_idle") {
        await Effect.runPromise(
          binding.runMutation(
            Effect.succeed({
              value: undefined,
              changes: [
                { type: "transcript_event", event: idleStatus },
                { type: "transcript_event", event: { ...base, type: "session_idle" } },
              ],
            }),
          ),
        );
      }
      expect(occurrences).toEqual([]);
      expect(envelopes.some((envelope) => envelope.type === "transcript_event")).toBe(false);
      const held = await Effect.runPromise(service.read(current.ref));
      expect(held.type === "live" && held.session.activity).toBe("running");
      expect(held.type === "live" && held.session.executionEpisodeId).toBe(
        initial.type === "live" && initial.session.executionEpisodeId,
      );
      current = { ...current, activity: releaseActivity };
      await Effect.runPromise(service.holdWorkflowLaunch(current.ref, false));
      expect(occurrences).toEqual(releaseActivity === "idle" ? ["agent.session_idle"] : []);
      const terminal = envelopes.filter((envelope) => envelope.type === "transcript_event");
      const expectedTerminal: typeof terminal =
        releaseActivity !== "idle"
          ? []
          : [
              { type: "transcript_event", event },
              ...(type === "session_idle"
                ? [{ type: "transcript_event" as const, event: idleStatus }]
                : []),
            ];
      expect(terminal).toEqual(expectedTerminal);
      // A later native idle still ends a running turn exactly once.
      await Effect.runPromise(
        binding.runMutation(
          Effect.succeed({
            value: undefined,
            changes: [{ type: "transcript_event" as const, event }],
          }),
        ),
      );
      expect(occurrences).toEqual(["agent.session_idle"]);
    }
  },
);

test.each(["before", "after"] as const)(
  "preserves completed-turn metadata without idle notices when stop arrives %s idle",
  async (order) => {
    const snapshot = liveSnapshot("stopped");
    const occurrences: string[] = [];
    const events: AgentSessionLiveEnvelope[] = [];
    const projector = createSessionOccurrenceProjector({
      repositoryLabel: "Repo",
      resolveAssociation: () => ({ kind: "workflow", taskId: "task-1", role: "build" }),
      resolveTask: (id) => ({ id, title: "Task" }),
    });
    const service = createAgentSessionLiveStateService({
      runtimeAdmission: passThroughAdmission,
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      publish: (event) => events.push(event),
      observeNotificationInput: (event, provenance) => {
        occurrences.push(...projector.accept(event, provenance).map((notice) => notice.kind));
      },
    });
    const binding = service.createRuntimeRegistration({
      runtimeId: "stopped-runtime",
      runtimeKind: "codex",
    });
    await Effect.runPromise(
      service.registerRuntimeAdapter({
        ...fakeAdapter({ runtimeId: "stopped-runtime", snapshots: () => [snapshot] }),
        binding,
      }),
    );
    await Effect.runPromise(service.holdWorkflowLaunch(snapshot.ref, true));
    const base = {
      sessionRef: snapshot.ref,
      externalSessionId: snapshot.ref.externalSessionId,
      timestamp: "2026-10-04T00:00:01.000Z",
    };
    const idle: AgentSessionTranscriptEvent = {
      ...base,
      type: "session_idle",
      turnCompleted: true,
    };
    const stopped: AgentSessionTranscriptEvent = {
      ...base,
      type: "session_finished",
      message: "Session stopped",
    };
    await Effect.runPromise(
      binding.runMutation(
        Effect.succeed({
          value: undefined,
          changes: (order === "before" ? [stopped, idle] : [idle, stopped]).map((event) => ({
            type: "transcript_event" as const,
            event,
          })),
        }),
      ),
    );
    expect(occurrences).toEqual([]);
    await Effect.runPromise(service.holdWorkflowLaunch(snapshot.ref, false));
    expect(occurrences).toEqual([]);
    expect(events.filter((event) => event.type === "transcript_event")).toEqual([
      { type: "transcript_event", event: stopped },
      { type: "transcript_event", event: idle },
    ]);
  },
);

test.each(["turn_error", "session_error"] as const)(
  "passes native %s through a launch hold and republishes idle state on release",
  async (type) => {
    const { service, events } = createHarness();
    const snapshot = liveSnapshot("failed");
    const binding = service.createRuntimeRegistration({
      runtimeId: "failed-runtime",
      runtimeKind: "codex",
    });
    await Effect.runPromise(
      service.registerRuntimeAdapter({
        ...fakeAdapter({ runtimeId: "failed-runtime", snapshots: () => [snapshot] }),
        binding,
      }),
    );
    await Effect.runPromise(service.holdWorkflowLaunch(snapshot.ref, true));
    const idle: AgentSessionTranscriptEvent = {
      type: "session_idle",
      sessionRef: snapshot.ref,
      externalSessionId: snapshot.ref.externalSessionId,
      timestamp: "2026-10-04T00:00:01.000Z",
    };
    const failure: AgentSessionTranscriptEvent = {
      type,
      sessionRef: snapshot.ref,
      externalSessionId: snapshot.ref.externalSessionId,
      timestamp: "2026-10-04T00:00:02.000Z",
      message: "Exact native failure",
    };
    await Effect.runPromise(
      binding.runMutation(
        Effect.succeed({
          value: undefined,
          changes: [
            { type: "transcript_event", event: idle },
            { type: "transcript_event", event: failure },
            { type: "session_upsert", snapshot },
          ],
        }),
      ),
    );
    const transcript = () => events.filter((envelope) => envelope.type === "transcript_event");
    expect(transcript()).toEqual([{ type: "transcript_event", event: failure }]);
    // The error does not end the hold, so the first turn still shows as running.
    const held = await Effect.runPromise(service.read(snapshot.ref));
    expect(held.type === "live" && held.session.activity).toBe("running");
    const published = events.length;

    await Effect.runPromise(service.holdWorkflowLaunch(snapshot.ref, false));

    const released = events.slice(published);
    expect(released.filter((envelope) => envelope.type === "transcript_event")).toEqual([
      { type: "transcript_event", event: idle },
    ]);
    const releasedSnapshots = released.flatMap((envelope) =>
      envelope.type === "session_upsert" ? [envelope.session] : [],
    );
    expect(releasedSnapshots.map((session) => session.activity)).toEqual(["idle"]);
    const settled = await Effect.runPromise(service.read(snapshot.ref));
    expect(settled.type === "live" && settled.session.activity).toBe("idle");
  },
);

test("a launch failure stays in session snapshots and notifies once until an accepted message", async () => {
  const envelopes: AgentSessionLiveEnvelope[] = [];
  const occurrences: string[] = [];
  const projector = createSessionOccurrenceProjector({
    repositoryLabel: "Repo",
    resolveAssociation: () => ({ kind: "workflow", taskId: "task-1", role: "build" }),
    resolveTask: (id) => ({ id, title: "Task" }),
  });
  const current = liveSnapshot("launched");
  const other = liveSnapshot("other");
  const service = createAgentSessionLiveStateService({
    runtimeAdmission: passThroughAdmission,
    adapterRegistry: createLiveSessionAdapterRegistry(),
    faultLog: () => Effect.void,
    publish: (envelope) => envelopes.push(envelope),
    observeNotificationInput: (envelope, provenance) => {
      occurrences.push(...projector.accept(envelope, provenance).map((notice) => notice.kind));
    },
  });
  const binding = service.createRuntimeRegistration({
    runtimeId: "launch-runtime",
    runtimeKind: "codex",
  });
  await Effect.runPromise(
    service.registerRuntimeAdapter({
      ...titleControlAdapter(() => Effect.die(new Error("unexpected title update"))),
      ...fakeAdapter({ runtimeId: "launch-runtime", snapshots: () => [current, other] }),
      supportsSessionControl: true,
      binding,
      sendUserMessage: (input) =>
        Effect.succeed({
          type: "user_message" as const,
          externalSessionId: input.externalSessionId,
          timestamp: "2026-10-10T10:02:00.000Z",
          messageId: "message-1",
          message: "Continue",
          parts: [{ kind: "text" as const, text: "Continue" }],
          state: "read" as const,
        }),
    }),
  );
  const message =
    "The session launch failed: Timed out. Inspect the session before you send it again.";
  const published = envelopes.length;
  await Effect.runPromise(service.reportLaunchFailure(current.ref, message));

  // The failure is host state. It updates the snapshot and does not end the runtime turn.
  const reported = envelopes.slice(published);
  expect(reported).toMatchObject([
    {
      type: "session_upsert",
      session: { ref: current.ref, launchFailure: { message } },
    },
  ]);
  const upsert = reported[0];
  if (upsert?.type !== "session_upsert" || !upsert.session.launchFailure)
    throw new Error("Expected the launch failure in the session snapshot.");
  const launchFailure = upsert.session.launchFailure;
  expect(occurrences).toEqual(["agent.session_error"]);
  // A later snapshot update with the same failure does not notify again.
  await Effect.runPromise(service.holdWorkflowLaunch(current.ref, true));
  await Effect.runPromise(service.holdWorkflowLaunch(current.ref, false));
  expect(occurrences).toEqual(["agent.session_error"]);

  // A browser that attaches later receives the failure in the session snapshot.
  await Effect.runPromise(service.refresh({ repoPath: current.ref.repoPath }));
  const attached = envelopes.at(-1);
  if (attached?.type !== "snapshot") throw new Error("Expected a fresh snapshot.");
  expect(attached.sessions.map((session) => session.launchFailure)).toEqual([
    launchFailure,
    undefined,
  ]);
  await expect(Effect.runPromise(service.read(current.ref))).resolves.toMatchObject({
    session: { launchFailure },
  });

  await Effect.runPromise(
    service.sendUserMessage({
      ...current.ref,
      sessionScope: { kind: "repository" },
      parts: [{ kind: "text", text: "Continue" }],
    }),
  );
  const read = await Effect.runPromise(service.read(current.ref));
  expect(read.type === "live" && read.session.launchFailure).toBeUndefined();
});

test("a launch failure of a session that is not live is left to the caller", async () => {
  const envelopes: AgentSessionLiveEnvelope[] = [];
  const current = liveSnapshot("launched");
  const service = createAgentSessionLiveStateService({
    runtimeAdmission: passThroughAdmission,
    adapterRegistry: createLiveSessionAdapterRegistry(),
    faultLog: () => Effect.void,
    publish: (envelope) => envelopes.push(envelope),
  });
  await Effect.runPromise(
    service.registerRuntimeAdapter(
      fakeAdapter({ runtimeId: "launch-runtime", snapshots: () => [current] }),
    ),
  );
  const published = envelopes.length;
  const detached = liveSnapshot("detached").ref;
  // Nothing can show this failure, so the launch result must not claim a notice.
  await expect(
    Effect.runPromise(service.reportLaunchFailure(detached, "The session launch failed.")),
  ).resolves.toBeNull();
  expect(envelopes.slice(published)).toEqual([]);
  await Effect.runPromise(service.refresh({ repoPath: current.ref.repoPath }));
  const attached = envelopes.at(-1);
  if (attached?.type !== "snapshot") throw new Error("Expected a fresh snapshot.");
  expect(attached.sessions.map((session) => session.launchFailure)).toEqual([undefined]);
});

describe("createAgentSessionLiveStateService", () => {
  test("does not read saved roots when the adapter has no snapshot refresh", async () => {
    const events: AgentSessionLiveEnvelope[] = [];
    const service = createAgentSessionLiveStateService({
      runtimeAdmission: passThroughAdmission,
      adapterRegistry: createLiveSessionAdapterRegistry(),
      readSessionRootRefs: () => Effect.die(new Error("Unexpected saved root read.")),
      faultLog: () => Effect.void,
      publish: (event) => events.push(event),
    });
    const snapshot = liveSnapshot("session-1");
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-1",
          snapshots: () => [snapshot],
        }),
      ),
    );
    expect(events).toMatchObject([{ type: "session_upsert", session: snapshot }]);
  });

  test.each(["roots", "snapshots"])(
    "a failed %s read gives its repository a fault and keeps the shared runtime registered",
    async (source) => {
      const failure = new HostOperationError({
        operation: `test.${source}`,
        message: `Cannot read ${source}.`,
      });
      let failing = false;
      const adapterRegistry = createLiveSessionAdapterRegistry();
      const events: AgentSessionLiveEnvelope[] = [];
      const service = createAgentSessionLiveStateService({
        runtimeAdmission: passThroughAdmission,
        adapterRegistry,
        readSessionRootRefs: () =>
          failing && source === "roots" ? Effect.fail(failure) : Effect.succeed([]),
        faultLog: () => Effect.void,
        publish: (event) => events.push(event),
      });
      const adapter = fakeAdapter({
        runtimeId: "runtime-1",
        snapshots: () => [liveSnapshot("session-1")],
        refreshEffect: () =>
          failing && source === "snapshots" ? Effect.fail(failure) : Effect.void,
      });
      // Registration reads only repositories that a renderer observed before.
      await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
      failing = true;
      events.length = 0;

      await Effect.runPromise(service.registerRuntimeAdapter(adapter));

      expect(adapterRegistry.list()).toEqual([adapter]);
      expect(events).toMatchObject([
        {
          type: "fault",
          repoPath: "/repo",
          operation: "agent-session-live.restore-runtime-sessions",
          message: `Cannot restore the ${adapter.binding.runtimeKind} sessions of this repository: Cannot read ${source}.`,
        },
        { type: "session_upsert" },
      ]);
    },
  );

  describe("attach", () => {
    const createAttachHarness = () => {
      const events: AgentSessionLiveEnvelope[] = [];
      const counts = { rootReads: 0, refreshes: 0 };
      const control = { failRoots: false, failRefresh: false };
      const failure = new HostOperationError({ operation: "test.roots", message: "Roots failed" });
      const service = createAgentSessionLiveStateService({
        runtimeAdmission: passThroughAdmission,
        adapterRegistry: createLiveSessionAdapterRegistry(),
        readSessionRootRefs: () =>
          Effect.sleep("1 millis").pipe(
            Effect.andThen(
              Effect.suspend(() => {
                counts.rootReads += 1;
                return control.failRoots ? Effect.fail(failure) : Effect.succeed([]);
              }),
            ),
          ),
        faultLog: () => Effect.void,
        publish: (event) => events.push(event),
      });
      const adapter = (runtimeId: string) =>
        fakeAdapter({
          runtimeId,
          snapshots: () => [liveSnapshot("session-1")],
          refreshEffect: () =>
            Effect.suspend(() => {
              counts.refreshes += 1;
              return control.failRefresh ? Effect.fail(failure) : Effect.void;
            }),
        });
      return { adapter, control, counts, events, service };
    };

    test("restores a repository once and answers later attachments from the live projection", async () => {
      const { adapter, counts, events, service } = createAttachHarness();
      await Effect.runPromise(service.registerRuntimeAdapter(adapter("runtime-1")));
      expect(events).toMatchObject([{ type: "session_upsert", sequence: 1 }]);
      events.length = 0;

      const first = await Effect.runPromise(service.attach({ repoPath: "/repo" }));
      const second = await Effect.runPromise(service.attach({ repoPath: "/repo" }));

      expect(first).toEqual({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [{ ...liveSnapshot("session-1"), executionEpisodeId: expect.any(String) }],
        sequence: 1,
      });
      expect(second).toEqual(first);
      expect(counts).toEqual({ rootReads: 1, refreshes: 1 });
      // The caller receives its snapshot. Other observers receive nothing.
      expect(events).toEqual([]);
    });

    test("concurrent first attachments share one restoration and its failure", async () => {
      const { adapter, control, counts, service } = createAttachHarness();
      await Effect.runPromise(service.registerRuntimeAdapter(adapter("runtime-1")));
      control.failRoots = true;

      const results = await Effect.runPromise(
        Effect.all(
          [service.attach({ repoPath: "/repo" }), service.attach({ repoPath: "/repo" })].map(
            Effect.result,
          ),
          { concurrency: "unbounded" },
        ),
      );

      expect(results.map((result) => result._tag)).toEqual(["Failure", "Failure"]);
      expect(counts.rootReads).toBe(1);
      control.failRoots = false;
      await Effect.runPromise(service.attach({ repoPath: "/repo" }));
      expect(counts).toEqual({ rootReads: 2, refreshes: 1 });
    });

    test("a failed runtime restoration makes the next attachment restore the repository again", async () => {
      const { adapter, control, counts, events, service } = createAttachHarness();
      await Effect.runPromise(service.registerRuntimeAdapter(adapter("runtime-1")));
      await Effect.runPromise(service.attach({ repoPath: "/repo" }));
      await Effect.runPromise(service.releaseRuntime("runtime-1"));
      control.failRefresh = true;
      events.length = 0;

      await Effect.runPromise(service.registerRuntimeAdapter(adapter("runtime-2")));
      expect(events).toMatchObject([
        { type: "fault", operation: "agent-session-live.restore-runtime-sessions" },
        { type: "session_upsert" },
      ]);
      control.failRefresh = false;
      await Effect.runPromise(service.attach({ repoPath: "/repo" }));
      await Effect.runPromise(service.attach({ repoPath: "/repo" }));

      expect(counts).toEqual({ rootReads: 3, refreshes: 3 });
    });
  });

  test("rejects a session start for a blocked workspace before resolving an adapter", async () => {
    const withProcessStartAdmission: WithProcessStartAdmission = (repoPath) =>
      Effect.fail(
        new HostValidationError({
          message: `Workspace is closed: ${repoPath}. Reopen it before using it.`,
          field: "workspaceId",
        }),
      );
    const { service } = createHarness(withProcessStartAdmission);

    const failure = await expectHostFailure(
      service.startSession({
        repoPath: "/closed-repo",
        runtimeKind: "opencode",
        workingDirectory: "/closed-repo",
        sessionScope: { kind: "repository" },
        systemPrompt: "Work.",
      }),
    );

    expect(failure.message).toBe("Workspace is closed: /closed-repo. Reopen it before using it.");
  });

  test("resets the published collection after a failed detach read and a replacement registration", async () => {
    const { service, events } = createHarness();
    const old = {
      ...liveSnapshot("old"),
      activity: "waiting_for_question" as const,
      pendingQuestions: [{ requestId: "old-question", questions: [] }],
    };
    const next = liveSnapshot("new");
    const cleanupStarted = Promise.withResolvers<void>();
    const cleanupFinish = Promise.withResolvers<void>();
    let broken = false;
    await Effect.runPromise(
      service.registerRuntimeAdapter({
        ...fakeAdapter({
          runtimeId: "old-runtime",
          snapshots: () => [old],
          listEffect: () =>
            broken
              ? Effect.fail(
                  new HostOperationError({ operation: "list", message: "detach read failed" }),
                )
              : Effect.succeed([old]),
        }),
        releaseRuntime: () =>
          Effect.promise(async () => {
            cleanupStarted.resolve();
            await cleanupFinish.promise;
            return [old.ref];
          }),
      }),
    );
    broken = true;
    const release = Effect.runPromiseExit(service.releaseRuntime("old-runtime"));
    await cleanupStarted.promise;
    try {
      await Effect.runPromise(
        service.registerRuntimeAdapter(
          fakeAdapter({ runtimeId: "new-runtime", snapshots: () => [next] }),
        ),
      );
    } finally {
      cleanupFinish.resolve();
    }
    expect((await release)._tag).toBe("Failure");
    expect(events.at(-1)).toMatchObject({ type: "snapshot", repoPath: "/repo", sessions: [next] });
    expect(await Effect.runPromise(service.list({ repoPath: "/repo" }))).toMatchObject([next]);
  });

  test("publishes released references when an unrelated adapter cannot read its snapshots", async () => {
    const { service, events } = createHarness();
    const owned = liveSnapshot("owned");
    let broken = false;
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({ runtimeId: "released", snapshots: () => [owned] }),
      ),
    );
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "other",
          runtimeKind: "opencode",
          snapshots: () => [],
          listEffect: () =>
            broken
              ? Effect.fail(
                  new HostOperationError({
                    operation: "other-read",
                    message: "Other adapter read failed",
                  }),
                )
              : Effect.succeed([]),
        }),
      ),
    );
    events.length = 0;
    broken = true;
    expect(await Effect.runPromise(service.releaseRuntime("released"))).toEqual([owned.ref]);
    expect(events).toEqual([{ type: "session_removed", ref: owned.ref, sequence: 2 }]);
  });
  test("publishes the same execution episode to list, read, and refresh consumers", async () => {
    const { events, service } = createHarness();
    const snapshot = liveSnapshot("shared-episode");
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-codex",
          snapshots: () => [snapshot],
        }),
      ),
    );
    const listed = await Effect.runPromise(service.list({ repoPath: "/repo" }));
    const episodeId = listed[0]?.executionEpisodeId;
    expect(episodeId).toBeString();
    expect(await Effect.runPromise(service.read(snapshot.ref))).toEqual({
      type: "live",
      session: { ...snapshot, executionEpisodeId: episodeId },
    });
    events.length = 0;
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    expect(events).toEqual([
      {
        type: "snapshot",
        repoPath: "/repo",
        sessions: [{ ...snapshot, executionEpisodeId: episodeId }],
        sequence: 2,
      },
    ]);
  });

  test("asks each runtime for all current sessions on refresh", async () => {
    let snapshots = [liveSnapshot("runtime-session", "opencode")];
    const refreshCalls: string[] = [];
    const { events, service } = createHarness();
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-opencode",
          runtimeKind: "opencode",
          snapshots: () => snapshots,
          refreshEffect: () => Effect.sync(() => refreshCalls.push("opencode")),
        }),
      ),
    );
    events.length = 0;
    refreshCalls.length = 0;

    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    snapshots = [liveSnapshot("next-runtime-session", "opencode")];
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    expect(refreshCalls).toEqual(["opencode", "opencode"]);
    expect(events).toMatchObject([
      {
        type: "snapshot",
        repoPath: "/repo",
        sessions: [liveSnapshot("runtime-session", "opencode")],
      },
      {
        type: "snapshot",
        repoPath: "/repo",
        sessions: [liveSnapshot("next-runtime-session", "opencode")],
      },
    ]);
  });

  test("keeps refresh requests in order", async () => {
    const { adapterRegistry, service } = createHarness();
    let snapshots: AgentSessionLiveSnapshot[] = [];
    let markFirstRefreshStarted: () => void = () => undefined;
    let finishFirstRefresh: () => void = () => undefined;
    const firstRefreshStarted = new Promise<void>((resolve) => {
      markFirstRefreshStarted = resolve;
    });
    const firstRefreshGate = new Promise<void>((resolve) => {
      finishFirstRefresh = resolve;
    });
    let listCount = 0;
    await Effect.runPromise(
      adapterRegistry.register(
        fakeAdapter({
          runtimeId: "runtime-opencode",
          runtimeKind: "opencode",
          snapshots: () => snapshots,
          listEffect: () =>
            Effect.promise(async () => {
              listCount += 1;
              if (listCount === 1) {
                markFirstRefreshStarted();
                await firstRefreshGate;
              }
              snapshots = [liveSnapshot(listCount === 1 ? "first" : "next", "opencode")];
              return snapshots;
            }),
        }),
      ),
    );

    const firstRefresh = Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    await firstRefreshStarted;
    const nextRefresh = Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    await Promise.resolve();
    expect(listCount).toBe(1);
    finishFirstRefresh();
    await Promise.all([firstRefresh, nextRefresh]);

    expect(listCount).toBe(2);
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toMatchObject([
      liveSnapshot("next", "opencode"),
    ]);
  });

  test("loads all runtime sessions when an adapter joins after the first refresh", async () => {
    const { events, service } = createHarness();
    const snapshots = [liveSnapshot("runtime-session", "opencode")];
    const refreshCalls: string[] = [];

    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-opencode",
          runtimeKind: "opencode",
          snapshots: () => snapshots,
          refreshEffect: () => Effect.sync(() => refreshCalls.push("opencode")),
        }),
      ),
    );

    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toMatchObject([
      liveSnapshot("runtime-session", "opencode"),
    ]);
    expect(events).toMatchObject([
      { type: "snapshot", repoPath: "/repo", sessions: [] },
      { type: "session_upsert", session: liveSnapshot("runtime-session", "opencode") },
    ]);
    expect(refreshCalls).toEqual(["opencode"]);
  });

  test("preserves repository scope across snapshots, list, read, and events", async () => {
    const { events, service } = createHarness();
    const snapshot = {
      ...liveSnapshot("repository-session"),
      repositoryScope: { kind: "repository" } as const,
    };
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({ runtimeId: "runtime-1", snapshots: () => [snapshot] }),
      ),
    );

    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toMatchObject([
      snapshot,
    ]);
    await expect(Effect.runPromise(service.read(snapshot.ref))).resolves.toMatchObject({
      type: "live",
      session: snapshot,
    });
    expect(events).toMatchObject([
      { type: "session_upsert", session: snapshot },
      { type: "snapshot", repoPath: "/repo", sessions: [snapshot] },
    ]);
  });

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
      mutateRegisteredAdapter(
        service,
        Effect.sync(() => {
          snapshots = [updated];
          return {
            value: undefined,
            changes: [{ type: "session_upsert" as const, snapshot: updated }],
          };
        }),
      ),
    );

    await Effect.runPromise(Effect.yieldNow);
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
      mutateRegisteredAdapter(
        service,
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
      mutateRegisteredAdapter(
        service,
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
    const current = {
      ...liveSnapshot("session-1"),
      contextUsage: { totalTokens: 10 },
    };
    let snapshots: ReadonlyArray<AgentSessionLiveSnapshot> = [current];
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
      ...current,
      contextUsage: { totalTokens: 25 },
    };
    const contextFiber = Effect.runFork(
      mutateRegisteredAdapter(
        service,
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
      mutateRegisteredAdapter(
        service,
        Effect.succeed({
          value: undefined,
          changes: [{ type: "session_upsert" as const, snapshot: updated }],
        }),
      ),
    );

    expect(events).toMatchObject([{ type: "session_upsert", session: updated }]);
  });

  test("publishes a failed status read on its scoped fault", async () => {
    const { events, service } = createHarness();
    const ref = sessionRef("session-1");

    await Effect.runPromise(
      mutateRegisteredAdapter(
        service,
        Effect.succeed({
          value: undefined,
          changes: [
            {
              type: "fault" as const,
              repoPath: "/repo",
              operation: "opencode-live-session.refresh-session",
              message: "Session status read failed.",
              ref,
              statusUnavailable: true as const,
            },
          ],
        }),
      ),
    );

    expect(events).toEqual([
      {
        type: "fault",
        repoPath: "/repo",
        operation: "opencode-live-session.refresh-session",
        message: "Session status read failed.",
        ref,
        statusUnavailable: true,
      },
    ]);
  });

  test("publishes a scoped adapter fault with its exact live-session ref", async () => {
    const { events, faultLogs, service } = createHarness();
    const ref = sessionRef("session-1");

    await Effect.runPromise(
      mutateRegisteredAdapter(
        service,
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
      mutateRegisteredAdapter(
        service,
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
      runtimeAdmission: passThroughAdmission,
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () =>
        Effect.sync(() => {
          logAttempts += 1;
        }).pipe(Effect.andThen(Effect.fail(logFailure))),
      publish: (event) => events.push(event),
    });

    const failure = await expectHostFailure(
      mutateRegisteredAdapter(
        service,
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
      runtimeAdmission: passThroughAdmission,
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.fail(logFailure),
      publish: (event) => events.push(event),
    });

    const failure = await expectHostFailure(
      mutateRegisteredAdapter(
        service,
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
      {
        type: "session_upsert",
        session: { ...snapshot, executionEpisodeId: expect.any(String) },
        sequence: 1,
      },
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
      runtimeAdmission: passThroughAdmission,
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
      mutateRegisteredAdapter(
        service,
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
      runtimeAdmission: passThroughAdmission,
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
      mutateRegisteredAdapter(
        service,
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
      runtimeAdmission: passThroughAdmission,
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () =>
        Effect.sync(() => {
          logAttempts += 1;
        }).pipe(Effect.andThen(Effect.fail(logFailure))),
      publish: () => {
        publishAttempts += 1;
        throw publishFailure;
      },
    });

    const failure = await expectHostFailure(
      mutateRegisteredAdapter(
        service,
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

    expect(events).toEqual([{ type: "snapshot", repoPath: "/repo", sessions: [], sequence: 1 }]);
    expect(faultLogs).toEqual([]);
  });

  test("context failure does not make current pending/session state unreadable", async () => {
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
    const malformed: AgentSessionLiveSnapshot = {
      ...liveSnapshot("session-1"),
      startedAt: "not-an-iso-timestamp",
    };

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
    const current = liveSnapshot("original-session");
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({ runtimeId: "runtime-1", snapshots: () => [current] }),
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

    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toMatchObject([
      current,
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
    const current = await Effect.runPromise(service.list({ repoPath: "/repo" }));
    expect(current.map((entry) => entry.ref.externalSessionId)).toEqual(["opencode-1"]);
  });

  test("releases adapter state and removes sessions when the final current read fails", async () => {
    const { events, service } = createHarness();
    const snapshot = liveSnapshot("session-1");
    let failSnapshotRead = false;
    let releaseCalled = false;
    const adapter = {
      ...fakeAdapter({
        runtimeId: "runtime-1",
        snapshots: () => [snapshot],
        listEffect: () =>
          failSnapshotRead
            ? Effect.fail(
                new HostOperationError({
                  operation: "test.list-snapshots",
                  message: "live snapshot read failed",
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
    failSnapshotRead = true;

    await expect(Effect.runPromise(service.releaseRuntime("runtime-1"))).rejects.toThrow(
      "live snapshot read failed",
    );

    expect(releaseCalled).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "snapshot", repoPath: "/repo", sessions: [] });
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([]);
  });

  test("reports transcript settlement failure while still releasing runtime resources", async () => {
    const { events, service } = createHarness();
    const snapshot = liveSnapshot("session-1");
    let released = false;
    const adapter: AgentSessionLiveAdapterPort = {
      ...fakeAdapter({ runtimeId: "runtime-1", snapshots: () => [snapshot] }),
      settleRuntimeTranscript: () =>
        Effect.fail(
          new HostOperationError({
            operation: "test.settle-transcript",
            message: "image settlement failed",
          }),
        ),
      releaseRuntime: () =>
        Effect.sync(() => {
          released = true;
          return [snapshot.ref];
        }),
    };
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));
    await expect(Effect.runPromise(service.releaseRuntime("runtime-1"))).rejects.toThrow(
      "image settlement failed",
    );
    expect(released).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "session_removed", ref: snapshot.ref });
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([]);
  });

  test("publishes an authoritative snapshot when current reads and cleanup both fail", async () => {
    const { events, service } = createHarness();
    const snapshot = liveSnapshot("session-1");
    let failSnapshotRead = false;
    const adapter = {
      ...fakeAdapter({
        runtimeId: "runtime-1",
        snapshots: () => [snapshot],
        listEffect: () =>
          failSnapshotRead
            ? Effect.fail(
                new HostOperationError({
                  operation: "test.list-snapshots",
                  message: "live snapshot read failed",
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
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    failSnapshotRead = true;
    events.length = 0;

    await expect(Effect.runPromise(service.releaseRuntime("runtime-1"))).rejects.toThrow(
      "live snapshot read failed",
    );

    expect(events).toEqual([{ type: "snapshot", repoPath: "/repo", sessions: [], sequence: 3 }]);
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([]);
  });

  test("routes an unloaded session resume through the repository runtime scope", async () => {
    const { service } = createHarness();
    const summary = {
      externalSessionId: "persisted-session",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/persisted-session",
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
      queries: unexpectedRuntimeQueries,
      sessionImport: unexpectedSessionImport,
      supportsSessionControl: true,
      startSession: () => Effect.die(new Error("unexpected start")),
      resumeSession: (input) =>
        Effect.sync(() => {
          resumeInput = input;
          return summary;
        }),
      continueInterruptedTurn: () => Effect.die(new Error("unexpected continue")),
      forkSession: () => Effect.die(new Error("unexpected fork")),
      sendUserMessage: () => Effect.die(new Error("unexpected send")),
      updateSessionModel: () => Effect.die(new Error("unexpected model update")),
      updateSessionTitle: () => Effect.die(new Error("unexpected title update")),
      stopSession: () => Effect.die(new Error("unexpected stop")),
      releaseSession: () => Effect.die(new Error("unexpected release")),
    } satisfies AgentSessionRuntimeAdapterPort;
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));

    const input = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/persisted-session",
      externalSessionId: "persisted-session",
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
    };

    await expect(
      Effect.runPromise(service.resumeSession({ ...input, resumeMode: "reattach" })),
    ).resolves.toEqual(summary);
    expect(resumeInput).toEqual({ ...input, resumeMode: "reattach" });
  });

  test("admits one interrupted-turn continuation per session and releases the guard", async () => {
    const { service } = createHarness();
    const summary = {
      externalSessionId: "persisted-session",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/persisted-session",
      startedAt: "2026-07-16T10:00:00.000Z",
      status: "running" as const,
    };
    const continuationStarted = await Effect.runPromise(Deferred.make<void>());
    const releaseContinuation = await Effect.runPromise(Deferred.make<void>());
    const continuationInputs: unknown[] = [];
    const adapter = {
      ...fakeAdapter({ runtimeId: "runtime-1", snapshots: () => [] }),
      queries: unexpectedRuntimeQueries,
      sessionImport: unexpectedSessionImport,
      supportsSessionControl: true,
      startSession: () => Effect.die(new Error("unexpected start")),
      resumeSession: () => Effect.die(new Error("unexpected resume")),
      continueInterruptedTurn: (input: { externalSessionId: string; workingDirectory: string }) => {
        continuationInputs.push(input);
        return Effect.gen(function* () {
          yield* Deferred.succeed(continuationStarted, undefined);
          yield* Deferred.await(releaseContinuation);
          return summary;
        });
      },
      forkSession: () => Effect.die(new Error("unexpected fork")),
      sendUserMessage: () => Effect.die(new Error("unexpected send")),
      updateSessionModel: () => Effect.die(new Error("unexpected model update")),
      updateSessionTitle: () => Effect.die(new Error("unexpected title update")),
      stopSession: () => Effect.die(new Error("unexpected stop")),
      releaseSession: () => Effect.die(new Error("unexpected release")),
    } satisfies AgentSessionRuntimeAdapterPort;
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));

    const input = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/persisted-session",
      externalSessionId: "persisted-session",
      sessionScope: { kind: "repository" as const },
    };
    const first = Effect.runPromise(service.continueInterruptedTurn(input));
    await Effect.runPromise(Deferred.await(continuationStarted));

    const blocked = await expectHostFailure(service.continueInterruptedTurn(input));
    expect(blocked).toMatchObject({ reason: "continuation_in_progress" });
    expect(continuationInputs).toHaveLength(1);

    await Effect.runPromise(Deferred.succeed(releaseContinuation, undefined));
    await expect(first).resolves.toMatchObject({ externalSessionId: "persisted-session" });

    await expect(Effect.runPromise(service.continueInterruptedTurn(input))).resolves.toMatchObject({
      externalSessionId: "persisted-session",
    });
    expect(continuationInputs).toHaveLength(2);
  });

  test("classifies a missing live runtime as runtime_unavailable", async () => {
    const { service } = createHarness();

    const failure = await expectHostFailure(
      service.continueInterruptedTurn({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/missing-session",
        externalSessionId: "missing-session",
        sessionScope: { kind: "repository" },
      }),
    );

    expect(failure).toMatchObject({
      _tag: "HostOperationError",
      reason: "runtime_unavailable",
      operation: "agent-session.continue-interrupted-turn",
      sessionRef: {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/missing-session",
        externalSessionId: "missing-session",
      },
      nextAction: "Restore or restart the runtime for this session, then retry Resume.",
    });
  });

  test("classifies a runtime without session control as unsupported", async () => {
    const { service } = createHarness();
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        fakeAdapter({
          runtimeId: "runtime-without-control",
          runtimeKind: "opencode",
          snapshots: () => [],
        }),
      ),
    );

    const failure = await expectHostFailure(
      service.continueInterruptedTurn({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/persisted-session",
        externalSessionId: "persisted-session",
        sessionScope: { kind: "repository" },
      }),
    );

    expect(failure).toMatchObject({
      _tag: "HostOperationError",
      reason: "unsupported",
      operation: "agent-session.continue-interrupted-turn",
      nextAction:
        "Use a runtime that supports interrupted-turn resume, or send a new message to start new work.",
    });
  });

  test("routes unloaded session controls through the repository runtime scope", async () => {
    const { service } = createHarness();
    const calls: Array<{ operation: string; input: unknown }> = [];
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
      queries: unexpectedRuntimeQueries,
      sessionImport: unexpectedSessionImport,
      supportsSessionControl: true,
      startSession: () => Effect.die(new Error("unexpected start")),
      resumeSession: () => Effect.die(new Error("unexpected resume")),
      continueInterruptedTurn: () => Effect.die(new Error("unexpected continue")),
      forkSession: () => Effect.die(new Error("unexpected fork")),
      sendUserMessage: (input) =>
        Effect.sync(() => {
          calls.push({ operation: "send", input });
          return accepted;
        }),
      updateSessionModel: (input) =>
        Effect.sync(() => {
          calls.push({ operation: "model", input });
        }),
      updateSessionTitle: (input) =>
        Effect.sync(() => {
          calls.push({ operation: "title", input });
          return { status: "renamed" as const };
        }),
      stopSession: (input) =>
        Effect.sync(() => {
          calls.push({ operation: "stop", input });
        }),
      releaseSession: (input) =>
        Effect.sync(() => {
          calls.push({ operation: "release", input });
        }),
    } satisfies AgentSessionRuntimeAdapterPort;
    await Effect.runPromise(service.registerRuntimeAdapter(adapter));
    const input = {
      ...sessionRef("persisted-session"),
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
      parts: [{ kind: "text" as const, text: "Continue" }],
    };

    await expect(Effect.runPromise(service.sendUserMessage(input))).resolves.toEqual(accepted);
    await Effect.runPromise(service.updateSessionModel({ ...input, model: null }));
    await Effect.runPromise(service.updateSessionTitle({ ...input, title: "Renamed session" }));
    await Effect.runPromise(service.stopSession(input));
    await Effect.runPromise(service.releaseSession(input));

    expect(calls).toEqual([
      { operation: "send", input },
      { operation: "model", input: { ...input, model: null } },
      { operation: "title", input: { ...input, title: "Renamed session" } },
      { operation: "stop", input },
      { operation: "release", input },
    ]);
  });

  test("keeps a committed title rename when the runtime is released during the call", async () => {
    const { service } = createHarness();
    const entered = await Effect.runPromise(Deferred.make<void>());
    const finish = await Effect.runPromise(Deferred.make<void>());
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        titleControlAdapter(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(finish);
            return { status: "renamed" as const };
          }),
        ),
      ),
    );

    const rename = Effect.runFork(
      service.updateSessionTitle({ ...sessionRef("session-1"), title: "Renamed session" }),
    );
    await Effect.runPromise(Deferred.await(entered));
    await Effect.runPromise(service.releaseRuntime("runtime-1"));
    await Effect.runPromise(Deferred.succeed(finish, undefined));

    await expect(Effect.runPromise(Fiber.join(rename))).resolves.toEqual({ status: "renamed" });
  });

  test("reports the released runtime for an uncommitted title outcome", async () => {
    const { service } = createHarness();
    const entered = await Effect.runPromise(Deferred.make<void>());
    const finish = await Effect.runPromise(Deferred.make<void>());
    await Effect.runPromise(
      service.registerRuntimeAdapter(
        titleControlAdapter(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(finish);
            return { status: "not_attached" as const };
          }),
        ),
      ),
    );

    const rename = Effect.runFork(
      service.updateSessionTitle({ ...sessionRef("session-1"), title: "Renamed session" }),
    );
    await Effect.runPromise(Deferred.await(entered));
    await Effect.runPromise(service.releaseRuntime("runtime-1"));
    await Effect.runPromise(Deferred.succeed(finish, undefined));

    const failure = await expectHostFailure(Fiber.join(rename));
    expect(failure).toMatchObject({
      _tag: "HostOperationError",
      operation: "agent-session-live.runtime-detached",
    });
  });

  test("fails scoped operations when the kind has no live runtime", async () => {
    const { service } = createHarness();
    const ref = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo",
      externalSessionId: "repository-session",
      sessionScope: { kind: "repository" as const },
      resumeMode: "reattach" as const,
    };
    const expectMissingRoute = async (effect: Effect.Effect<unknown, HostError>) => {
      const error = await expectHostFailure(effect);
      expect(error.message).toBe(
        "The codex runtime is not running. Check Diagnostics, then restart the runtime.",
      );
    };

    await expectMissingRoute(service.resumeSession(ref));
    await expectMissingRoute(
      service.forkSession({
        repoPath: ref.repoPath,
        runtimeKind: ref.runtimeKind,
        workingDirectory: ref.workingDirectory,
        parentExternalSessionId: ref.externalSessionId,
        sessionScope: ref.sessionScope,
        systemPrompt: "Use the repo rules.",
      }),
    );
    await expectMissingRoute(
      service.sendUserMessage({ ...ref, parts: [{ kind: "text", text: "Continue" }] }),
    );
    await expectMissingRoute(service.loadContext(ref));
  });
});
