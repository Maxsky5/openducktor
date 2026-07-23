import { describe, expect, test } from "bun:test";
import type {
  OpencodeNativeApprovalReply,
  OpencodeNativeQuestionReply,
  OpencodeRuntimeSnapshotSource,
  OpencodeSessionRuntimeConnection,
  OpencodeSessionRuntimeSignal,
  PrepareOpencodeSessionRuntime,
} from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterPort,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import { createLiveSessionAdapterRegistry } from "./live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "./opencode-live-session-adapter";

const runtime: RuntimeInstanceSummary = {
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43123" },
  startedAt: "2026-07-16T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
};

const ref = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};

const nativeSource = (
  overrides: Partial<OpencodeRuntimeSnapshotSource> = {},
): OpencodeRuntimeSnapshotSource => ({
  externalSessionId: "session-1",
  title: "Live OpenCode session",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-07-16T10:01:00.000Z",
  runtimeActivity: "idle",
  pendingApprovals: [
    {
      requestId: "permission-1",
      requestInstanceId: "native-permission-instance",
      requestType: "file_change",
      title: "Edit a file",
      metadata: { source: "opencode" },
    },
  ],
  pendingQuestions: [
    {
      requestId: "question-1",
      requestInstanceId: "native-question-instance",
      questions: [
        {
          header: "Confirm",
          question: "Continue?",
          options: [{ label: "Yes", description: "Continue" }],
        },
      ],
    },
  ],
  ...overrides,
});

const controlSummary = {
  externalSessionId: "controlled-session",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
  title: "Controlled session",
  role: "build" as const,
  startedAt: "2026-07-16T10:02:00.000Z",
  status: "running" as const,
};

type RuntimeHarness = {
  readonly prepareRuntime: PrepareOpencodeSessionRuntime;
  readonly emit: (signal: OpencodeSessionRuntimeSignal) => Promise<void>;
  readonly approvalReplies: OpencodeNativeApprovalReply[];
  readonly questionReplies: OpencodeNativeQuestionReply[];
  readonly controlCalls: Array<{ operation: string; input: unknown }>;
  readonly releaseCalls: string[];
  readonly contextLoadCalls: string[];
  readonly setSources: (sources: OpencodeRuntimeSnapshotSource[]) => void;
};

const createRuntimeHarness = (): RuntimeHarness => {
  let listener: ((signal: OpencodeSessionRuntimeSignal) => void | Promise<void>) | null = null;
  const sources = [nativeSource()];
  const approvalReplies: OpencodeNativeApprovalReply[] = [];
  const questionReplies: OpencodeNativeQuestionReply[] = [];
  const controlCalls: Array<{ operation: string; input: unknown }> = [];
  const releaseCalls: string[] = [];
  const contextLoadCalls: string[] = [];

  const connection: OpencodeSessionRuntimeConnection = {
    readSessionSources: async () => sources,
    loadContextUsage: async (input) => {
      contextLoadCalls.push(input.externalSessionId);
      return {
        totalTokens: 999,
        model: { providerId: "openai", modelId: "gpt-5.1" },
      };
    },
    replyApproval: async (input) => {
      approvalReplies.push(input);
    },
    replyQuestion: async (input) => {
      questionReplies.push(input);
    },
    startSession: async (input) => {
      controlCalls.push({ operation: "start", input });
      return controlSummary;
    },
    resumeSession: async (input) => {
      controlCalls.push({ operation: "resume", input });
      return controlSummary;
    },
    forkSession: async (input) => {
      controlCalls.push({ operation: "fork", input });
      return controlSummary;
    },
    sendUserMessage: async (input) => {
      controlCalls.push({ operation: "send", input });
      return {
        type: "user_message",
        externalSessionId: input.externalSessionId,
        timestamp: "2026-07-16T10:03:00.000Z",
        messageId: "user-1",
        message: "Hello",
        parts: [{ kind: "text", text: "Hello" }],
        state: "queued",
      };
    },
    updateSessionModel: async (input) => {
      controlCalls.push({ operation: "model", input });
    },
    stopSession: async (input) => {
      controlCalls.push({ operation: "stop", input });
    },
    releaseSession: async (input) => {
      controlCalls.push({ operation: "release", input });
    },
  };

  return {
    prepareRuntime: async (input) => ({
      connection,
      initialSources: sources,
      initialContextUsageBySessionId: new Map([
        [
          "session-1",
          {
            totalTokens: 321,
            model: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
            },
          },
        ],
      ]),
      startForwarding: async (nextListener) => {
        listener = nextListener;
      },
      release: async () => {
        releaseCalls.push(input.runtimeId);
        listener = null;
      },
    }),
    emit: async (signal) => {
      if (!listener) {
        throw new Error("Forwarding has not started.");
      }
      await listener(signal);
    },
    approvalReplies,
    questionReplies,
    controlCalls,
    releaseCalls,
    contextLoadCalls,
    setSources: (nextSources) => {
      sources.splice(0, sources.length, ...nextSources);
    },
  };
};

const createLifecycle = (changes: AgentSessionLiveAdapterChange[]) =>
  ({
    registerRuntimeAdapter: () => Effect.void,
    releaseRuntime: () => Effect.succeed([]),
    runAdapterMutation: (mutation) =>
      mutation.pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            changes.push(...result.changes);
          }),
        ),
        Effect.map((result) => result.value),
      ),
  }) satisfies RuntimeLiveSessionLifecyclePort;

describe("createOpenCodeLiveSessionAdapterPreparer", () => {
  test("owns strict snapshots, opaque replies, retained context, and normalized signals", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;

    const snapshots = await Effect.runPromise(adapter.listRetainedSnapshots("/repo"));
    expect(snapshots).toEqual([
      {
        ref,
        activity: "waiting_for_question",
        title: "Live OpenCode session",
        startedAt: "2026-07-16T10:01:00.000Z",
        pendingApprovals: [
          {
            requestId: "opencode-pending-1",
            requestType: "file_change",
            title: "Edit a file",
          },
        ],
        pendingQuestions: [
          {
            requestId: "opencode-pending-2",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          },
        ],
        contextUsage: {
          totalTokens: 321,
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
        },
      } satisfies AgentSessionLiveSnapshot,
    ]);
    await expect(Effect.runPromise(adapter.loadContext(ref))).resolves.toEqual({
      totalTokens: 321,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });
    expect(harness.contextLoadCalls).toEqual([]);

    await Effect.runPromise(
      adapter.replyApproval({
        ...ref,
        requestId: "opencode-pending-1",
        outcome: "approve_once",
      }),
    );
    await Effect.runPromise(
      adapter.replyQuestion({
        ...ref,
        requestId: "opencode-pending-2",
        answers: [["Yes"]],
      }),
    );
    expect(harness.approvalReplies).toEqual([
      {
        ref,
        nativeRequestId: "permission-1",
        outcome: "approve_once",
      },
    ]);
    expect(harness.questionReplies).toEqual([
      {
        ref,
        nativeRequestId: "question-1",
        answers: [["Yes"]],
      },
    ]);
    expect(publishedChanges.filter((change) => change.type === "session_upsert")).toHaveLength(2);

    publishedChanges.length = 0;
    await Effect.runPromise(prepared.startForwarding());
    const transcriptEvent = {
      type: "assistant_delta",
      externalSessionId: "session-1",
      timestamp: "2026-07-16T10:04:00.000Z",
      channel: "text",
      delta: "hello",
    } satisfies Omit<
      Extract<AgentSessionTranscriptEvent, { type: "assistant_delta" }>,
      "sessionRef"
    >;
    await harness.emit({
      type: "transcript_event",
      externalSessionId: "session-1",
      event: transcriptEvent,
    });
    await harness.emit({
      type: "fault",
      message: "OpenCode live event observation failed: connection lost",
    });
    expect(publishedChanges).toEqual([
      {
        type: "transcript_event",
        event: { ...transcriptEvent, sessionRef: ref },
      },
      {
        type: "fault",
        repoPath: "/repo",
        operation: "opencode-live-session.observe-runtime",
        message: "OpenCode live event observation failed: connection lost",
      },
    ]);
  });

  test("keeps missing-context work demand-driven and shares one in-flight request", async () => {
    const harness = createRuntimeHarness();
    harness.setSources([
      nativeSource({
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    ]);
    let resolveContext: (value: { totalTokens: number }) => void = () => undefined;
    const contextGate = new Promise<{ totalTokens: number }>((resolve) => {
      resolveContext = resolve;
    });
    const originalPrepare = harness.prepareRuntime;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
        initialContextUsageBySessionId: new Map(),
        connection: {
          ...prepared.connection,
          loadContextUsage: async (sessionRef) => {
            harness.contextLoadCalls.push(sessionRef.externalSessionId);
            return contextGate;
          },
        },
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime),
    );
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;

    const first = Effect.runPromise(adapter.loadContext(ref));
    const second = Effect.runPromise(adapter.loadContext(ref));
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
    resolveContext({ totalTokens: 77 });

    await expect(first).resolves.toEqual({ totalTokens: 77 });
    await expect(second).resolves.toEqual({ totalTokens: 77 });
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
  });

  test("loads context for a persisted session without retaining a live snapshot", async () => {
    const harness = createRuntimeHarness();
    harness.setSources([]);
    const originalPrepare = harness.prepareRuntime;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
        initialContextUsageBySessionId: new Map(),
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime),
    );

    await expect(Effect.runPromise(prepared.adapter.loadContext(ref))).resolves.toEqual({
      totalTokens: 999,
      providerId: "openai",
      modelId: "gpt-5.1",
    });
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
    await expect(
      Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo")),
    ).resolves.toEqual([]);
  });

  test("keeps pending replies usable after context or native reply failures", async () => {
    const harness = createRuntimeHarness();
    const originalPrepare = harness.prepareRuntime;
    let approvalAttempts = 0;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
        initialContextUsageBySessionId: new Map(),
        connection: {
          ...prepared.connection,
          loadContextUsage: async () => {
            throw new Error("context endpoint unavailable");
          },
          replyApproval: async (reply) => {
            approvalAttempts += 1;
            if (approvalAttempts === 1) {
              throw new Error("approval endpoint unavailable");
            }
            await prepared.connection.replyApproval(reply);
          },
        },
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime),
    );
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;

    await expect(Effect.runPromise(adapter.loadContext(ref))).rejects.toThrow(
      "context endpoint unavailable",
    );
    await expect(
      Effect.runPromise(
        adapter.replyApproval({
          ...ref,
          requestId: "opencode-pending-1",
          outcome: "approve_once",
        }),
      ),
    ).rejects.toThrow("approval endpoint unavailable");

    const afterFailures = await Effect.runPromise(adapter.readRetainedSnapshot(ref));
    expect(afterFailures).toMatchObject({
      type: "live",
      session: { pendingApprovals: [{ requestId: "opencode-pending-1" }] },
    });

    await Effect.runPromise(
      adapter.replyApproval({
        ...ref,
        requestId: "opencode-pending-1",
        outcome: "approve_once",
      }),
    );
    const afterReply = await Effect.runPromise(adapter.readRetainedSnapshot(ref));
    expect(afterReply).toMatchObject({ type: "live", session: { pendingApprovals: [] } });
    expect(harness.approvalReplies).toHaveLength(1);
  });

  test("isolates identical native request ids across runtime adapters", async () => {
    const firstHarness = createRuntimeHarness();
    const secondHarness = createRuntimeHarness();
    secondHarness.setSources([
      nativeSource({
        externalSessionId: "session-2",
        pendingQuestions: [],
      }),
    ]);
    const secondRuntime: RuntimeInstanceSummary = {
      ...runtime,
      runtimeId: "runtime-2",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43124" },
    };
    const secondRef = { ...ref, externalSessionId: "session-2" };
    const prepareAdapter = createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: createLifecycle([]),
      prepareRuntime: (input) =>
        input.runtimeId === runtime.runtimeId
          ? firstHarness.prepareRuntime(input)
          : secondHarness.prepareRuntime(input),
    });

    const first = await Effect.runPromise(prepareAdapter(runtime));
    const second = await Effect.runPromise(prepareAdapter(secondRuntime));
    const firstAdapter = first.adapter as AgentSessionRuntimeAdapterPort;
    const secondAdapter = second.adapter as AgentSessionRuntimeAdapterPort;
    const firstSnapshot = await Effect.runPromise(firstAdapter.readRetainedSnapshot(ref));
    const secondSnapshot = await Effect.runPromise(secondAdapter.readRetainedSnapshot(secondRef));
    if (firstSnapshot.type !== "live" || secondSnapshot.type !== "live") {
      throw new Error("Expected both OpenCode runtime snapshots to be live.");
    }
    const firstRequestId = firstSnapshot.session.pendingApprovals[0]?.requestId;
    const secondRequestId = secondSnapshot.session.pendingApprovals[0]?.requestId;
    if (!firstRequestId || !secondRequestId) {
      throw new Error("Expected both OpenCode runtimes to retain a pending approval.");
    }
    expect(firstRequestId).not.toBe(secondRequestId);

    await Effect.runPromise(
      firstAdapter.replyApproval({
        ...ref,
        requestId: firstRequestId,
        outcome: "approve_once",
      }),
    );
    const retainedSecond = await Effect.runPromise(secondAdapter.readRetainedSnapshot(secondRef));
    expect(retainedSecond).toMatchObject({
      type: "live",
      session: { pendingApprovals: [{ requestId: secondRequestId }] },
    });
    expect(firstHarness.approvalReplies[0]?.nativeRequestId).toBe("permission-1");
    expect(secondHarness.approvalReplies).toEqual([]);
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
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;
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
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;
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

  test("releases only the owning adapter after an observation fault", async () => {
    const harness = createRuntimeHarness();
    const envelopes: Array<{ type: string }> = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      publish: (envelope) => envelopes.push(envelope),
    });
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: service,
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));

    const otherRef = { ...ref, externalSessionId: "session-2" };
    const otherSnapshot: AgentSessionLiveSnapshot = {
      ref: otherRef,
      activity: "idle",
      title: "Other runtime session",
      startedAt: "2026-07-16T10:02:00.000Z",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    };
    const otherAdapter: AgentSessionLiveAdapterPort = {
      binding: { runtimeId: "runtime-2", runtimeKind: "opencode", repoPath: "/repo" },
      matches: (candidate) => candidate.externalSessionId === otherRef.externalSessionId,
      listRetainedSnapshots: (repoPath) =>
        Effect.succeed(repoPath === "/repo" ? [otherSnapshot] : []),
      readRetainedSnapshot: (candidate) =>
        Effect.succeed(
          candidate.externalSessionId === otherRef.externalSessionId
            ? ({ type: "live", session: otherSnapshot } as const)
            : ({ type: "missing", ref: candidate } as const),
        ),
      loadContext: () => Effect.succeed(null),
      replyApproval: () => Effect.void,
      replyQuestion: () => Effect.void,
      releaseRuntime: () => Effect.succeed([otherRef]),
    };
    await Effect.runPromise(service.registerRuntimeAdapter(otherAdapter));
    await Effect.runPromise(prepared.startForwarding());
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    envelopes.length = 0;

    await harness.emit({
      type: "fault",
      message: "OpenCode live event observation failed: connection lost",
    });

    const retained = await Effect.runPromise(service.list({ repoPath: "/repo" }));
    expect(retained.map((snapshot) => snapshot.ref.externalSessionId)).toEqual(["session-2"]);
    expect(harness.releaseCalls).toEqual(["runtime-1"]);
    expect(envelopes.map((envelope) => envelope.type)).toEqual(["fault", "session_removed"]);
    await Effect.runPromise(service.releaseRuntime("runtime-2"));
  });
});
