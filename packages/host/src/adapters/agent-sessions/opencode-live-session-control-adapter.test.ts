import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import { createOpenCodeLiveSessionAdapterPreparer } from "./opencode-live-session-adapter";
import {
  controlSummary,
  createLifecycle,
  createRuntimeHarness,
  nativeSource,
  ref,
  runtime,
} from "./opencode-live-session-adapter.test-support";

describe("OpenCode live session controls", () => {
  test("publishes workflow forks without a subagent parent", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    try {
      await Effect.runPromise(
        prepared.adapter.forkSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          sessionScope: controlSummary.sessionAssociation,
          systemPrompt: "Build it",
          parentExternalSessionId: "planner-session",
        }),
      );

      expect(harness.controlCalls).toContainEqual({
        operation: "fork",
        input: expect.objectContaining({ parentExternalSessionId: "planner-session" }),
      });
      const snapshots = await Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo"));
      const fork = snapshots.find(
        (snapshot) => snapshot.ref.externalSessionId === "controlled-session",
      );
      if (!fork) {
        throw new Error("Expected a retained workflow fork.");
      }
      expect(fork).toMatchObject({ sessionAssociation: controlSummary.sessionAssociation });
      expect(fork.parentExternalSessionId).toBeUndefined();
      expect(publishedChanges).toContainEqual({ type: "session_upsert", snapshot: fork });
    } finally {
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    }
  });

  test("preserves runtime-reported subagent ancestry when resuming a child", async () => {
    const harness = createRuntimeHarness();
    harness.setSources([
      nativeSource({
        externalSessionId: "controlled-session",
        parentExternalSessionId: "builder-session",
        sessionAssociation: controlSummary.sessionAssociation,
      }),
    ]);
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    try {
      await Effect.runPromise(
        prepared.adapter.resumeSession({
          ...ref,
          externalSessionId: "controlled-session",
          sessionScope: controlSummary.sessionAssociation,
        }),
      );
      await expect(
        Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo")),
      ).resolves.toEqual([
        expect.objectContaining({
          parentExternalSessionId: "builder-session",
          sessionAssociation: controlSummary.sessionAssociation,
        }),
      ]);
    } finally {
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    }
  });

  test("delegates controls while the host projection remains the only session authority", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const adapter = prepared.adapter;
    const controlRef = { ...ref, externalSessionId: "controlled-session" };
    const startInput = {
      repoPath: "/repo",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree",
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
      systemPrompt: "Build it",
    };

    await expect(Effect.runPromise(adapter.startSession(startInput))).resolves.toEqual(
      controlSummary,
    );
    expect(adapter.matches(controlRef)).toBe(true);
    await Effect.runPromise(
      adapter.resumeSession({
        ...controlRef,
        sessionScope: startInput.sessionScope,
      }),
    );
    await Effect.runPromise(
      adapter.forkSession({
        ...startInput,
        parentExternalSessionId: "parent-1",
      }),
    );
    const accepted = await Effect.runPromise(
      adapter.sendUserMessage({
        ...controlRef,
        sessionScope: startInput.sessionScope,
        parts: [{ kind: "text", text: "Hello" }],
      }),
    );
    expect(accepted.type).toBe("user_message");
    expect(publishedChanges.filter((change) => change.type === "transcript_event")).toEqual([
      {
        type: "transcript_event",
        event: {
          type: "user_message",
          externalSessionId: "controlled-session",
          timestamp: "2026-07-16T10:03:00.000Z",
          messageId: "user-1",
          message: "Hello",
          parts: [{ kind: "text", text: "Hello" }],
          state: "queued",
          sessionRef: controlRef,
        },
      },
    ]);

    await Effect.runPromise(adapter.updateSessionModel({ ...controlRef, model: null }));
    await Effect.runPromise(adapter.stopSession(controlRef));
    expect(adapter.matches(controlRef)).toBe(false);
    await Effect.runPromise(
      adapter.resumeSession({
        ...controlRef,
        sessionScope: startInput.sessionScope,
      }),
    );
    expect(adapter.matches(controlRef)).toBe(true);
    await Effect.runPromise(adapter.releaseSession(controlRef));
    expect(adapter.matches(controlRef)).toBe(false);

    expect(harness.controlCalls.map((call) => call.operation)).toEqual([
      "start",
      "resume",
      "fork",
      "send",
      "model",
      "stop",
      "resume",
      "release",
    ]);
    expect(harness.controlCalls[0]?.input).toMatchObject({
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
      sessionScope: startInput.sessionScope,
    });
    await expect(Effect.runPromise(adapter.releaseRuntime())).resolves.toEqual([ref]);
    expect(harness.releaseCalls).toEqual(["runtime-1"]);
  });

  test("keeps concurrent session events current while a slash command send is pending", async () => {
    let resolveSendStarted: () => void = () => undefined;
    let releaseSend: () => void = () => undefined;
    const sendStarted = new Promise<void>((resolve) => {
      resolveSendStarted = resolve;
    });
    const sendBarrier = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const harness = createRuntimeHarness({
      sendUserMessageBarrier: sendBarrier,
      onSendUserMessage: resolveSendStarted,
    });
    harness.setSources([
      nativeSource({ pendingApprovals: [], pendingQuestions: [] }),
      nativeSource({
        externalSessionId: "session-2",
        title: "Other OpenCode session",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    ]);
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const adapter = prepared.adapter;
    const sending = Effect.runPromise(
      adapter.sendUserMessage({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        parts: [
          {
            kind: "slash_command",
            command: { id: "review", trigger: "review", title: "review", hints: [] },
          },
        ],
      }),
    );
    await sendStarted;

    const forwarding = harness.emit({
      type: "transcript_event",
      externalSessionId: "session-2",
      event: {
        type: "session_status",
        externalSessionId: "session-2",
        timestamp: "2026-07-16T10:04:00.000Z",
        status: { type: "busy", message: null },
      },
    });

    try {
      try {
        const result = await Promise.race([
          forwarding.then(() => "forwarded" as const),
          new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 500)),
        ]);
        expect(result).toBe("forwarded");
        await expect(
          Effect.runPromise(
            adapter.readRetainedSnapshot({ ...ref, externalSessionId: "session-2" }),
          ),
        ).resolves.toMatchObject({ type: "live", session: { activity: "running" } });

        await harness.emit({
          type: "transcript_event",
          externalSessionId: "session-1",
          event: {
            type: "user_message",
            externalSessionId: "session-1",
            timestamp: "2026-07-16T10:04:01.000Z",
            messageId: "user-live",
            message: "/review",
            parts: [{ kind: "text", text: "/review" }],
            state: "queued",
          },
        });
        expect(publishedChanges).toContainEqual({
          type: "transcript_event",
          event: expect.objectContaining({
            type: "user_message",
            externalSessionId: "session-1",
            messageId: "user-live",
          }),
        });
        await harness.emit({
          type: "transcript_event",
          externalSessionId: "session-1",
          event: {
            type: "session_idle",
            externalSessionId: "session-1",
            timestamp: "2026-07-16T10:05:00.000Z",
          },
        });
      } finally {
        releaseSend();
        await sending;
        await forwarding;
      }

      await expect(Effect.runPromise(adapter.readRetainedSnapshot(ref))).resolves.toMatchObject({
        type: "live",
        session: { activity: "idle" },
      });
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  test("serializes sends within one session while other sessions stay concurrent", async () => {
    let releaseSends: () => void = () => undefined;
    let resolveFirstSend: () => void = () => undefined;
    let resolveSecondSend: () => void = () => undefined;
    let resolveThirdSend: () => void = () => undefined;
    const sendBarrier = new Promise<void>((resolve) => {
      releaseSends = resolve;
    });
    const firstSendStarted = new Promise<void>((resolve) => {
      resolveFirstSend = resolve;
    });
    const secondSendStarted = new Promise<void>((resolve) => {
      resolveSecondSend = resolve;
    });
    const thirdSendStarted = new Promise<void>((resolve) => {
      resolveThirdSend = resolve;
    });
    let startedSendCount = 0;
    const harness = createRuntimeHarness({
      sendUserMessageBarrier: sendBarrier,
      onSendUserMessage: () => {
        startedSendCount += 1;
        if (startedSendCount === 1) {
          resolveFirstSend();
        } else if (startedSendCount === 2) {
          resolveSecondSend();
        } else if (startedSendCount === 3) {
          resolveThirdSend();
        }
      },
    });
    harness.setSources([
      nativeSource({ pendingApprovals: [], pendingQuestions: [] }),
      nativeSource({
        externalSessionId: "session-2",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    ]);
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    const adapter = prepared.adapter;
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };
    const send = (externalSessionId: string) =>
      Effect.runPromise(
        adapter.sendUserMessage({
          ...ref,
          externalSessionId,
          sessionScope,
          parts: [{ kind: "text", text: "Hello" }],
        }),
      );
    const first = send("session-1");
    let queued: ReturnType<typeof send> | undefined;
    let other: ReturnType<typeof send> | undefined;

    try {
      await firstSendStarted;
      queued = send("session-1");
      expect(
        await Promise.race([
          secondSendStarted.then(() => "started" as const),
          new Promise<"queued">((resolve) => setTimeout(() => resolve("queued"), 100)),
        ]),
      ).toBe("queued");

      other = send("session-2");
      expect(
        await Promise.race([
          secondSendStarted.then(() => "started" as const),
          new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 500)),
        ]),
      ).toBe("started");

      releaseSends();
      await Promise.all([first, queued, other]);
      await thirdSendStarted;
      expect(
        harness.controlCalls
          .filter((call) => call.operation === "send")
          .map((call) => call.input.externalSessionId),
      ).toEqual(["session-1", "session-2", "session-1"]);
    } finally {
      releaseSends();
      await Promise.allSettled([first, ...(queued ? [queued] : []), ...(other ? [other] : [])]);
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  test("rejects a send result that arrives after the session is released", async () => {
    let resolveSendStarted: () => void = () => undefined;
    let releaseSend: () => void = () => undefined;
    const sendStarted = new Promise<void>((resolve) => {
      resolveSendStarted = resolve;
    });
    const sendBarrier = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const harness = createRuntimeHarness({
      sendUserMessageBarrier: sendBarrier,
      onSendUserMessage: resolveSendStarted,
    });
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const adapter = prepared.adapter;
    const sending = Effect.runPromise(
      adapter.sendUserMessage({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        parts: [{ kind: "text", text: "Hello" }],
      }),
    );
    await sendStarted;

    try {
      await Effect.runPromise(adapter.releaseSession(ref));
      releaseSend();

      await expect(sending).rejects.toThrow("is no longer retained");
      expect(adapter.matches(ref)).toBe(false);
      expect(
        publishedChanges.filter(
          (change) =>
            change.type === "transcript_event" && change.event.externalSessionId === "session-1",
        ),
      ).toEqual([]);
    } finally {
      releaseSend();
      await sending.catch(() => undefined);
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });

  for (const operation of ["start", "resume", "fork"] as const) {
    test(`reports the latest runtime association after ${operation} invalidation and refresh`, async () => {
      const harness = createRuntimeHarness();
      const publishedChanges: AgentSessionLiveAdapterChange[] = [];
      const prepared = await Effect.runPromise(
        createOpenCodeLiveSessionAdapterPreparer({
          liveSessionLifecycle: createLifecycle(publishedChanges),
          prepareRuntime: harness.prepareRuntime,
        })(runtime),
      );
      await Effect.runPromise(prepared.startForwarding());
      const adapter = prepared.adapter;
      const controlRef = { ...ref, externalSessionId: "controlled-session" };
      const sessionScope = {
        kind: "workflow" as const,
        taskId: "task-1",
        role: "build" as const,
      };
      const startInput = {
        repoPath: "/repo",
        runtimeKind: "opencode" as const,
        workingDirectory: "/repo/worktree",
        sessionScope,
        systemPrompt: "Build it",
      };

      if (operation === "start") {
        await Effect.runPromise(adapter.startSession(startInput));
      } else if (operation === "resume") {
        await Effect.runPromise(
          adapter.resumeSession({
            ...controlRef,
            sessionScope,
          }),
        );
      } else {
        await Effect.runPromise(
          adapter.forkSession({
            ...startInput,
            parentExternalSessionId: "parent-1",
          }),
        );
      }

      publishedChanges.length = 0;
      harness.setSources([
        nativeSource({
          externalSessionId: "controlled-session",
          sessionAssociation: { kind: "unbound" },
          title: "Refreshed runtime session",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
        }),
      ]);
      await harness.emit({ type: "sessions_invalidated" });

      await expect(Effect.runPromise(adapter.listRetainedSnapshots("/repo"))).resolves.toEqual([
        expect.objectContaining({
          ref: controlRef,
          sessionAssociation: { kind: "unbound" },
        }),
      ]);
      await expect(
        Effect.runPromise(adapter.readRetainedSnapshot(controlRef)),
      ).resolves.toMatchObject({
        type: "live",
        session: {
          ref: controlRef,
          sessionAssociation: { kind: "unbound" },
        },
      });
      expect(
        publishedChanges.filter(
          (change) =>
            change.type === "session_upsert" &&
            change.snapshot.ref.externalSessionId === "controlled-session",
        ),
      ).toEqual([
        {
          type: "session_upsert",
          snapshot: expect.objectContaining({
            ref: controlRef,
            sessionAssociation: { kind: "unbound" },
          }),
        },
      ]);
    });
  }

  test("commits an authoritative refresh only inside the host lifecycle mutation", async () => {
    const harness = createRuntimeHarness();
    let enterMutation: () => void = () => undefined;
    let releaseMutation: () => void = () => undefined;
    const mutationEntered = new Promise<void>((resolve) => {
      enterMutation = resolve;
    });
    const mutationBarrier = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const lifecycle: RuntimeLiveSessionLifecyclePort = {
      registerRuntimeAdapter: () => Effect.void,
      releaseRuntime: () => Effect.succeed([]),
      runAdapterMutation: (mutation) =>
        Effect.gen(function* () {
          yield* Effect.sync(enterMutation);
          yield* Effect.promise(() => mutationBarrier);
          const result = yield* mutation;
          publishedChanges.push(...result.changes);
          return result.value;
        }),
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: lifecycle,
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const adapter = prepared.adapter;
    harness.setSources([
      nativeSource({
        runtimeActivity: "running",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    ]);
    const forwarding = harness.emit({ type: "sessions_invalidated" });
    await mutationEntered;

    const beforeCommit = await Effect.runPromise(adapter.listRetainedSnapshots("/repo"));
    expect(beforeCommit[0]?.activity).toBe("waiting_for_question");
    releaseMutation();
    await forwarding;

    const afterCommit = await Effect.runPromise(adapter.listRetainedSnapshots("/repo"));
    expect(afterCommit[0]?.activity).toBe("running");
    expect(publishedChanges).toEqual([
      {
        type: "session_upsert",
        snapshot: expect.objectContaining({ ref, activity: "running" }),
      },
    ]);
  });

  test("projects status events without replacing them from a stale runtime read", async () => {
    const harness = createRuntimeHarness();
    harness.setSources([
      nativeSource({
        runtimeActivity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
      nativeSource({
        externalSessionId: "session-2",
        title: "Other OpenCode session",
        runtimeActivity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    ]);
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const adapter = prepared.adapter;

    await harness.emit({
      type: "transcript_event",
      externalSessionId: "session-1",
      event: {
        type: "session_status",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        status: { type: "busy", message: null },
      },
    });

    await expect(Effect.runPromise(adapter.readRetainedSnapshot(ref))).resolves.toMatchObject({
      type: "live",
      session: { activity: "running" },
    });
    await expect(
      Effect.runPromise(adapter.readRetainedSnapshot({ ...ref, externalSessionId: "session-2" })),
    ).resolves.toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });

    await harness.emit({
      type: "transcript_event",
      externalSessionId: "session-1",
      event: {
        type: "session_status",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:03:00.000Z",
        status: { type: "idle" },
      },
    });

    await expect(Effect.runPromise(adapter.readRetainedSnapshot(ref))).resolves.toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
    expect(
      publishedChanges
        .filter((change) => change.type === "session_upsert")
        .map((change) => (change.type === "session_upsert" ? change.snapshot.activity : null)),
    ).toEqual(["running", "idle"]);
  });

  test("projects a session error as authoritative idle activity", async () => {
    const harness = createRuntimeHarness();
    harness.setSources([
      nativeSource({
        runtimeActivity: "running",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    ]);
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const adapter = prepared.adapter;

    try {
      await harness.emit({
        type: "transcript_event",
        externalSessionId: "session-1",
        event: {
          type: "session_error",
          externalSessionId: "session-1",
          timestamp: "2026-07-16T10:03:00.000Z",
          message: "Provider failed",
        },
      });

      await expect(Effect.runPromise(adapter.readRetainedSnapshot(ref))).resolves.toMatchObject({
        type: "live",
        session: { activity: "idle" },
      });
      expect(publishedChanges).toContainEqual({
        type: "session_upsert",
        snapshot: expect.objectContaining({ ref, activity: "idle" }),
      });
    } finally {
      await Effect.runPromise(adapter.releaseRuntime());
    }
  });
});
