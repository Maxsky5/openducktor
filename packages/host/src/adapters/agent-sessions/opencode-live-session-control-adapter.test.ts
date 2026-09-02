import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import { createOpenCodeLiveSessionAdapterPreparer } from "./opencode-live-session-adapter";
import {
  controlMetadata,
  controlSummary,
  createLifecycle,
  createRuntimeHarness,
  ref,
  runtime,
} from "./opencode-live-session-adapter.test-support";

describe("OpenCode live session controls", () => {
  test("publishes created forks without task ownership or a subagent parent", async () => {
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
      expect(fork).not.toHaveProperty("sessionAssociation");
      expect(fork.repositoryScope).toBeUndefined();
      expect(fork.parentExternalSessionId).toBeUndefined();
      expect(publishedChanges).toContainEqual({ type: "session_upsert", snapshot: fork });
    } finally {
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    }
  });

  test("registers a resumed session only from its OpenDucktor control result", async () => {
    const harness = createRuntimeHarness();
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
      const snapshots = await Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo"));
      expect(snapshots).toEqual([
        expect.objectContaining({
          ref: expect.objectContaining({ externalSessionId: "controlled-session" }),
        }),
      ]);
      expect(snapshots[0]?.parentExternalSessionId).toBeUndefined();
      expect(snapshots[0]).not.toHaveProperty("sessionAssociation");
    } finally {
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    }
  });

  test("returns metadata-only controls while the host retains runtime state", async () => {
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
      controlMetadata,
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

    await Effect.runPromise(
      adapter.updateSessionModel({
        ...controlRef,
        sessionScope: startInput.sessionScope,
        model: null,
      }),
    );
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
    await expect(Effect.runPromise(adapter.releaseRuntime())).resolves.toEqual([]);
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
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const adapter = prepared.adapter;
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };
    await Effect.runPromise(adapter.resumeSession({ ...ref, sessionScope }));
    await Effect.runPromise(
      adapter.resumeSession({ ...ref, externalSessionId: "session-2", sessionScope }),
    );
    publishedChanges.length = 0;
    const sending = Effect.runPromise(
      adapter.sendUserMessage({
        ...ref,
        sessionScope,
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
      type: "session_event",
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
          type: "session_event",
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
          type: "session_event",
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
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    const adapter = prepared.adapter;
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };
    await Effect.runPromise(adapter.resumeSession({ ...ref, sessionScope }));
    await Effect.runPromise(
      adapter.resumeSession({ ...ref, externalSessionId: "session-2", sessionScope }),
    );
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
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };
    await Effect.runPromise(adapter.resumeSession({ ...ref, sessionScope }));
    const sending = Effect.runPromise(
      adapter.sendUserMessage({
        ...ref,
        sessionScope,
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
    test(`does not publish runtime association after ${operation} invalidation and refresh`, async () => {
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
      await harness.emit({
        type: "session_event",
        externalSessionId: "controlled-session",
        event: {
          type: "session_idle",
          externalSessionId: "controlled-session",
          timestamp: "2026-07-16T10:03:00.000Z",
        },
      });

      const snapshots = await Effect.runPromise(adapter.listRetainedSnapshots("/repo"));
      expect(snapshots).toEqual(
        expect.arrayContaining([expect.objectContaining({ ref: controlRef })]),
      );
      const snapshot = snapshots.find(
        (item) => item.ref.externalSessionId === controlRef.externalSessionId,
      );
      if (!snapshot) {
        throw new Error("Expected the controlled live session.");
      }
      expect(snapshot).not.toHaveProperty("sessionAssociation");
      expect(snapshot.repositoryScope).toBeUndefined();
      const retained = await Effect.runPromise(adapter.readRetainedSnapshot(controlRef));
      expect(retained).toMatchObject({ type: "live", session: { ref: controlRef } });
      if (retained.type !== "live") {
        throw new Error("Expected a retained live session.");
      }
      expect(retained.session).not.toHaveProperty("sessionAssociation");
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
          }),
        },
      ]);
      const upsert = publishedChanges.find(
        (change) =>
          change.type === "session_upsert" &&
          change.snapshot.ref.externalSessionId === "controlled-session",
      );
      if (!upsert || upsert.type !== "session_upsert") {
        throw new Error("Expected the refreshed session upsert.");
      }
      expect(upsert.snapshot).not.toHaveProperty("sessionAssociation");
    });
  }

  test("projects status events without changing another registered session", async () => {
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
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };
    await Effect.runPromise(adapter.resumeSession({ ...ref, sessionScope }));
    await Effect.runPromise(
      adapter.resumeSession({ ...ref, externalSessionId: "session-2", sessionScope }),
    );
    publishedChanges.length = 0;

    await harness.emit({
      type: "session_event",
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
      session: { activity: "running" },
    });

    await harness.emit({
      type: "session_event",
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
    ).toEqual(["idle"]);
  });

  test("projects a session error as authoritative idle activity", async () => {
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
    await Effect.runPromise(
      adapter.resumeSession({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );

    try {
      await harness.emit({
        type: "session_event",
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
