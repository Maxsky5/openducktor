import { describe, expect, test } from "bun:test";
import type {
  OpencodeLiveRuntimeAttachment,
  OpencodeLiveSessionChange,
  OpencodeLiveSessionController,
  OpencodeLiveSessionSnapshot,
  OpencodeSdkAdapterOptions,
} from "@openducktor/adapters-opencode-sdk";
import { createOpencodeLiveSessionController } from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect, Fiber } from "effect";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { HostOperationError } from "../../effect/host-errors";
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

const nativeSnapshot = (): OpencodeLiveSessionSnapshot => ({
  runtimeId: "runtime-1",
  ref,
  activity: "waiting_for_permission",
  title: "Live OpenCode session",
  startedAt: "2026-07-16T10:01:00.000Z",
  pendingApprovals: [
    {
      requestId: "opaque-approval-1",
      requestInstanceId: "private-occurrence-1",
      requestType: "file_change",
      title: "Edit a file",
      metadata: { nativeRequestId: "permission-1" },
    },
  ],
  pendingQuestions: [
    {
      requestId: "opaque-question-1",
      requestInstanceId: "private-occurrence-2",
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
    model: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    },
  },
});

type ControllerHarness = {
  controller: OpencodeLiveSessionController;
  emit: (change: OpencodeLiveSessionChange) => Promise<void>;
  approvalReplies: unknown[];
  questionReplies: unknown[];
  controlCalls: Array<{ operation: string; runtimeId: string; input: unknown }>;
  releaseCalls: string[];
  setSnapshots: (snapshots: OpencodeLiveSessionSnapshot[]) => void;
};

const createControllerHarness = (): ControllerHarness => {
  let listener: ((change: OpencodeLiveSessionChange) => void | Promise<void>) | null = null;
  const approvalReplies: unknown[] = [];
  const questionReplies: unknown[] = [];
  const controlCalls: Array<{ operation: string; runtimeId: string; input: unknown }> = [];
  const releaseCalls: string[] = [];
  const snapshots = [nativeSnapshot()];
  const attachment: OpencodeLiveRuntimeAttachment = {
    snapshots,
    startForwarding: async (nextListener) => {
      listener = nextListener;
    },
    release: async () => {
      releaseCalls.push("runtime-1");
      listener = null;
    },
  };
  return {
    controller: {
      initializeRuntime: async () => attachment,
      readRuntimeSnapshots: () => snapshots,
      loadSessionContextUsage: async () => nativeSnapshot().contextUsage,
      replyApproval: async (input) => {
        approvalReplies.push(input);
      },
      replyQuestion: async (input) => {
        questionReplies.push(input);
      },
      startSession: async (runtimeId, input) => {
        controlCalls.push({ operation: "start", runtimeId, input });
        return controlSummary;
      },
      resumeSession: async (runtimeId, input) => {
        controlCalls.push({ operation: "resume", runtimeId, input });
        return controlSummary;
      },
      forkSession: async (runtimeId, input) => {
        controlCalls.push({ operation: "fork", runtimeId, input });
        return controlSummary;
      },
      sendUserMessage: async (runtimeId, input) => {
        controlCalls.push({ operation: "send", runtimeId, input });
        const event = {
          type: "user_message" as const,
          externalSessionId: input.externalSessionId,
          timestamp: "2026-07-16T10:03:00.000Z",
          messageId: "user-1",
          message: "Hello",
          parts: [{ kind: "text" as const, text: "Hello" }],
          state: "queued" as const,
        };
        await listener?.({
          type: "transcript_event",
          runtimeId,
          ref: {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
          },
          event,
        });
        return event;
      },
      updateSessionModel: async (runtimeId, input) => {
        controlCalls.push({ operation: "model", runtimeId, input });
      },
      stopSession: async (runtimeId, input) => {
        controlCalls.push({ operation: "stop", runtimeId, input });
      },
      releaseSession: async (runtimeId, input) => {
        controlCalls.push({ operation: "release", runtimeId, input });
      },
      releaseRuntime: attachment.release,
    },
    emit: async (change) => {
      if (!listener) {
        throw new Error("Forwarding has not started.");
      }
      await listener(change);
    },
    approvalReplies,
    questionReplies,
    controlCalls,
    releaseCalls,
    setSnapshots: (nextSnapshots) => {
      snapshots.splice(0, snapshots.length, ...nextSnapshots);
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

const controlSummary = {
  externalSessionId: "controlled-session",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
  title: "Controlled session",
  role: "build" as const,
  startedAt: "2026-07-16T10:02:00.000Z",
  status: "running" as const,
};

const createNativeLiveControllerHarness = (): {
  client: ReturnType<NonNullable<OpencodeSdkAdapterOptions["createClient"]>>;
  emit: (event: unknown) => void;
} => {
  const queuedEvents: unknown[] = [];
  let wakeStream: (() => void) | null = null;
  const client = {
    session: {
      list: async () => ({
        data: [
          {
            id: "session-1",
            directory: "/repo/worktree",
            title: "Live OpenCode session",
            time: { created: Date.parse("2026-07-16T10:01:00.000Z") },
          },
        ],
        error: undefined,
      }),
      status: async () => ({ data: { "session-1": { type: "idle" } }, error: undefined }),
      messages: async () => ({ data: [], error: undefined }),
    },
    permission: {
      list: async () => ({ data: [], error: undefined }),
      reply: async () => ({ data: true, error: undefined }),
    },
    question: {
      list: async () => ({ data: [], error: undefined }),
      reply: async () => ({ data: true, error: undefined }),
    },
    global: {
      event: async (options?: { signal?: AbortSignal }) => ({
        stream: (async function* () {
          while (!options?.signal?.aborted) {
            if (queuedEvents.length === 0) {
              await new Promise<void>((resolve) => {
                wakeStream = resolve;
                options?.signal?.addEventListener("abort", () => resolve(), { once: true });
              });
            }
            const event = queuedEvents.shift();
            if (event) {
              yield { directory: "/repo/worktree", payload: event };
            }
          }
        })(),
      }),
    },
  } as unknown as ReturnType<NonNullable<OpencodeSdkAdapterOptions["createClient"]>>;
  return {
    client,
    emit: (event) => {
      queuedEvents.push(event);
      wakeStream?.();
      wakeStream = null;
    },
  };
};

describe("createOpenCodeLiveSessionAdapterPreparer", () => {
  test("releases through the real host service without waiting on a queued delivery", async () => {
    const native = createNativeLiveControllerHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: () => native.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const envelopes: Array<{ type: string }> = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      publish: (envelope) => envelopes.push(envelope),
    });
    let interceptForwarding = false;
    let resolveForwardingStarted: () => void = () => undefined;
    let releaseForwarding: () => void = () => undefined;
    let resolveForwardingFinished: () => void = () => undefined;
    const forwardingStarted = new Promise<void>((resolve) => {
      resolveForwardingStarted = resolve;
    });
    const forwardingGate = new Promise<void>((resolve) => {
      releaseForwarding = resolve;
    });
    const forwardingFinished = new Promise<void>((resolve) => {
      resolveForwardingFinished = resolve;
    });
    const lifecycle: Pick<
      RuntimeLiveSessionLifecyclePort,
      "releaseRuntime" | "runAdapterMutation"
    > = {
      releaseRuntime: service.releaseRuntime,
      runAdapterMutation: (mutation) => {
        if (!interceptForwarding) {
          return service.runAdapterMutation(mutation);
        }
        return Effect.gen(function* () {
          yield* Effect.sync(resolveForwardingStarted);
          yield* Effect.promise(() => forwardingGate);
          const value = yield* service.runAdapterMutation(mutation);
          yield* Effect.sync(resolveForwardingFinished);
          return value;
        });
      },
    };
    const preparer = createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: lifecycle,
      controller,
    });
    const prepared = await Effect.runPromise(preparer(runtime));
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
    await Effect.runPromise(prepared.startForwarding());
    envelopes.length = 0;
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    let resolveCoordinatorHeld: () => void = () => undefined;
    let releaseCoordinator: () => void = () => undefined;
    const coordinatorHeld = new Promise<void>((resolve) => {
      resolveCoordinatorHeld = resolve;
    });
    const coordinatorGate = new Promise<void>((resolve) => {
      releaseCoordinator = resolve;
    });
    const holder = Effect.runFork(
      service.runAdapterMutation(
        Effect.gen(function* () {
          yield* Effect.sync(resolveCoordinatorHeld);
          yield* Effect.promise(() => coordinatorGate);
          return { value: undefined, changes: [] };
        }),
      ),
    );
    await coordinatorHeld;
    interceptForwarding = true;
    native.emit({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-context",
          sessionID: "session-1",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 10, output: 5 },
        },
        parts: [],
      },
    });
    await forwardingStarted;

    const releasing = Effect.runPromise(
      service.releaseRuntime("runtime-1").pipe(Effect.timeout("500 millis")),
    );
    await Promise.resolve();
    releaseForwarding();
    await Promise.resolve();
    releaseCoordinator();

    await expect(releasing).resolves.toEqual([ref]);
    await forwardingFinished;
    await Effect.runPromise(Fiber.join(holder));
    expect(envelopes.map((envelope) => envelope.type)).toEqual(["snapshot", "session_removed"]);
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([]);
  });

  test("releases the runtime when a rejected host delivery terminates observation", async () => {
    const native = createNativeLiveControllerHarness();
    const controller = createOpencodeLiveSessionController({
      createClient: () => native.client,
      now: () => "2026-07-16T10:02:00.000Z",
    });
    const envelopes: Array<{ type: string; message?: string }> = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      publish: (envelope) => envelopes.push(envelope),
    });
    let rejectNextDelivery = false;
    let resolveRejectedDelivery: () => void = () => undefined;
    let resolveReleasedRuntime: () => void = () => undefined;
    const rejectedDelivery = new Promise<void>((resolve) => {
      resolveRejectedDelivery = resolve;
    });
    const releasedRuntime = new Promise<void>((resolve) => {
      resolveReleasedRuntime = resolve;
    });
    const lifecycle: Pick<
      RuntimeLiveSessionLifecyclePort,
      "releaseRuntime" | "runAdapterMutation"
    > = {
      releaseRuntime: (runtimeId) =>
        service
          .releaseRuntime(runtimeId)
          .pipe(Effect.tap(() => Effect.sync(resolveReleasedRuntime))),
      runAdapterMutation: (mutation) => {
        if (rejectNextDelivery) {
          rejectNextDelivery = false;
          resolveRejectedDelivery();
          return Effect.fail(
            new HostOperationError({
              operation: "test.opencode-live-session-delivery",
              message: "host listener rejected the delivery",
            }),
          );
        }
        return service.runAdapterMutation(mutation);
      },
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: lifecycle,
        controller,
      })(runtime),
    );
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
    await Effect.runPromise(prepared.startForwarding());
    envelopes.length = 0;
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    rejectNextDelivery = true;
    native.emit({
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-context",
          sessionID: "session-1",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5",
          tokens: { input: 10, output: 5 },
        },
        parts: [],
      },
    });

    await rejectedDelivery;
    await Promise.race([
      releasedRuntime,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Expected host runtime release after delivery fault.")),
          500,
        );
      }),
    ]);
    expect(envelopes.map((envelope) => envelope.type)).toEqual([
      "snapshot",
      "fault",
      "session_removed",
    ]);
    expect(envelopes.find((envelope) => envelope.type === "fault")?.message).toBe(
      "OpenCode live event observation failed: host listener rejected the delivery",
    );
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([]);
  });

  test("exposes strict runtime-neutral snapshots, context, replies, and ordered changes", async () => {
    const harness = createControllerHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const preparer = createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: createLifecycle(publishedChanges),
      controller: harness.controller,
    });
    const prepared = await Effect.runPromise(preparer(runtime));
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;

    const snapshots = await Effect.runPromise(adapter.listRetainedSnapshots("/repo"));
    expect(snapshots).toEqual([
      {
        ref,
        activity: "waiting_for_permission",
        title: "Live OpenCode session",
        startedAt: "2026-07-16T10:01:00.000Z",
        pendingApprovals: [
          {
            requestId: "opaque-approval-1",
            requestType: "file_change",
            title: "Edit a file",
          },
        ],
        pendingQuestions: [
          {
            requestId: "opaque-question-1",
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

    await Effect.runPromise(
      adapter.replyApproval({ ...ref, requestId: "opaque-approval-1", outcome: "approve_once" }),
    );
    await Effect.runPromise(
      adapter.replyQuestion({ ...ref, requestId: "opaque-question-1", answers: [["Yes"]] }),
    );
    expect(harness.approvalReplies).toEqual([
      {
        runtimeId: "runtime-1",
        ref,
        requestId: "opaque-approval-1",
        outcome: "approve_once",
      },
    ]);
    expect(harness.questionReplies).toEqual([
      {
        runtimeId: "runtime-1",
        ref,
        requestId: "opaque-question-1",
        answers: [["Yes"]],
      },
    ]);

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
      runtimeId: "runtime-1",
      ref,
      event: transcriptEvent,
    });
    await harness.emit({
      type: "runtime_fault",
      runtimeId: "runtime-1",
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

  test("releases only the owning host adapter after an unexpected observation fault", async () => {
    const harness = createControllerHarness();
    const envelopes: Array<{ type: string }> = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      publish: (envelope) => envelopes.push(envelope),
    });
    const preparer = createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: service,
      controller: harness.controller,
    });
    const prepared = await Effect.runPromise(preparer(runtime));
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
    envelopes.length = 0;
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    await harness.emit({
      type: "runtime_fault",
      runtimeId: "runtime-1",
      message: "OpenCode live event observation failed: connection lost",
    });

    const retained = await Effect.runPromise(service.list({ repoPath: "/repo" }));
    expect(retained.map((snapshot) => snapshot.ref.externalSessionId)).toEqual(["session-2"]);
    expect(harness.releaseCalls).toEqual(["runtime-1"]);
    expect(envelopes.map((envelope) => envelope.type)).toEqual([
      "snapshot",
      "fault",
      "session_removed",
    ]);
    await expect(Effect.runPromise(service.releaseRuntime("runtime-1"))).resolves.toEqual([]);
    expect(harness.releaseCalls).toEqual(["runtime-1"]);
    await Effect.runPromise(service.releaseRuntime("runtime-2"));
  });

  test("delegates all session controls and publishes the accepted user message", async () => {
    const harness = createControllerHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const preparer = createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: createLifecycle(publishedChanges),
      controller: harness.controller,
    });
    const prepared = await Effect.runPromise(preparer(runtime));
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
    await Effect.runPromise(
      adapter.sendUserMessage({
        ...controlRef,
        sessionScope: startInput.sessionScope,
        parts: [{ kind: "text", text: "Hello" }],
      }),
    );
    expect(publishedChanges).toEqual([
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
    expect(publishedChanges.at(-1)).toEqual({ type: "session_removed", ref: controlRef });
    expect(adapter.matches(controlRef)).toBe(false);
    await Effect.runPromise(
      adapter.resumeSession({
        ...controlRef,
        sessionScope: startInput.sessionScope,
      }),
    );
    const resumedSnapshot = {
      ...nativeSnapshot(),
      ref: controlRef,
      activity: "running" as const,
      pendingApprovals: [],
      pendingQuestions: [],
    };
    await harness.emit({ type: "session_upsert", snapshot: resumedSnapshot });
    expect(adapter.matches(controlRef)).toBe(true);
    expect(publishedChanges.at(-1)).toEqual({
      type: "session_upsert",
      snapshot: expect.objectContaining({ ref: controlRef, activity: "running" }),
    });
    await Effect.runPromise(adapter.releaseSession(controlRef));

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
    expect(harness.controlCalls[1]?.input).toMatchObject({
      runtimePolicy: { kind: "opencode" },
      sessionScope: startInput.sessionScope,
    });
    expect(harness.controlCalls[3]?.input).toMatchObject({
      runtimePolicy: { kind: "opencode" },
      sessionScope: startInput.sessionScope,
    });
    await expect(Effect.runPromise(adapter.releaseRuntime())).resolves.toEqual([ref]);
    expect(harness.releaseCalls).toEqual(["runtime-1"]);
    expect(harness.controlCalls.every((call) => call.runtimeId === "runtime-1")).toBe(true);
  });

  test("commits a forwarded snapshot only inside the lifecycle mutation", async () => {
    const harness = createControllerHarness();
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
    const preparer = createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: lifecycle,
      controller: harness.controller,
    });
    const prepared = await Effect.runPromise(preparer(runtime));
    await Effect.runPromise(prepared.startForwarding());
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;
    const updated = { ...nativeSnapshot(), activity: "running" as const };
    harness.setSnapshots([updated]);
    const forwarding = harness.emit({ type: "session_upsert", snapshot: updated });
    await mutationEntered;

    const beforeCommit = await Effect.runPromise(adapter.listRetainedSnapshots("/repo"));
    expect(beforeCommit[0]?.activity).toBe("waiting_for_permission");
    releaseMutation();
    await forwarding;

    const afterCommit = await Effect.runPromise(adapter.listRetainedSnapshots("/repo"));
    const committedSnapshot = afterCommit[0];
    if (!committedSnapshot) {
      throw new Error("Expected the committed OpenCode snapshot.");
    }
    expect(committedSnapshot.activity).toBe("running");
    expect(publishedChanges).toEqual([{ type: "session_upsert", snapshot: committedSnapshot }]);
  });
});
