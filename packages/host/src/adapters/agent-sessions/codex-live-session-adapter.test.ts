import { describe, expect, test } from "bun:test";
import type {
  CodexAppServerAdapter,
  CodexAppServerAdapterOptions,
  CodexSessionContextUsage,
} from "@openducktor/adapters-codex-app-server";
import {
  type AgentSessionLiveSnapshot,
  type AgentSessionWorkflowScope,
  type CodexEffectivePolicy,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterMutation,
} from "../../ports/agent-session-live-adapter-port";
import type {
  CodexAppServerPort,
  CodexAppServerRequestResult,
} from "../../ports/codex-app-server-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import { createCodexLiveSessionAdapterPreparer } from "./codex-live-session-adapter";
import { createLiveSessionAdapterRegistry } from "./live-session-adapter-registry";

const runtime: RuntimeInstanceSummary = {
  kind: "codex",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "stdio", identity: "runtime-1" },
  startedAt: "2026-07-16T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
};

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "thread-1",
};

const codexPolicy: CodexEffectivePolicy = {
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  commandNetworkAccess: false,
  approvalsReviewerApplies: true,
};

const resolveRuntimePolicy = (_scope: AgentSessionWorkflowScope) => Effect.succeed(codexPolicy);

const noBackgroundFailure = () => Effect.void;

const liveSnapshot = (): AgentSessionLiveSnapshot => ({
  ref,
  activity: "waiting_for_permission",
  title: "Live Codex session",
  startedAt: "2026-07-16T10:01:00.000Z",
  pendingApprovals: [
    {
      requestId: "pending-opaque-1",
      requestType: "command_execution",
      title: "Run command",
      command: { command: "bun test", workingDirectory: "/repo/worktree" },
      supportedReplyOutcomes: ["approve_once", "reject"],
    },
  ],
  pendingQuestions: [],
  contextUsage: null,
});

const codexAppServer = {
  request: () => Effect.dieMessage("Unexpected request"),
  listLoadedThreads: () => Effect.dieMessage("Unexpected listLoadedThreads"),
  listThreads: () => Effect.dieMessage("Unexpected listThreads"),
  respond: () => Effect.dieMessage("Unexpected respond"),
} satisfies CodexAppServerPort;

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

type ControllerHarnessOptions = {
  initialSnapshots?: AgentSessionLiveSnapshot[];
  releaseRuntime?: () => void;
  liveContextUsage?: CodexSessionContextUsage | null;
  persistedContextUsage?: CodexSessionContextUsage | null;
};

const createControllerHarness = ({
  initialSnapshots = [liveSnapshot()],
  releaseRuntime = () => undefined,
  liveContextUsage = { totalTokens: 123, contextWindow: 1_000 },
  persistedContextUsage = { totalTokens: 456, contextWindow: 2_000 },
}: ControllerHarnessOptions = {}) => {
  let options: CodexAppServerAdapterOptions | null = null;
  let snapshots = initialSnapshots;
  const rawEvents: unknown[] = [];
  const liveContextLoads: unknown[] = [];
  const policyBoundContextLoads: unknown[] = [];
  const controlInputs = {
    starts: [] as unknown[],
    resumes: [] as unknown[],
    forks: [] as unknown[],
    sends: [] as unknown[],
  };
  const controlSummary = {
    externalSessionId: "thread-1",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo/worktree",
    title: "Live Codex session",
    role: "build" as const,
    startedAt: "2026-07-16T10:01:00.000Z",
    status: "running" as const,
  };
  return {
    createController: (nextOptions: CodexAppServerAdapterOptions) => {
      options = nextOptions;
      return {
        prepareRuntime: async (runtimeId: string) => {
          await nextOptions.subscribeEvents?.(runtimeId, (event) => rawEvents.push(event));
        },
        listLiveSessionSnapshots: () => snapshots,
        loadLiveSessionContextUsage: async (input: unknown) => {
          liveContextLoads.push(input);
          const usage = liveContextUsage;
          const snapshot = snapshots[0];
          if (!snapshot) {
            throw new Error("Expected a retained Codex snapshot before loading context.");
          }
          snapshots = [{ ...snapshot, contextUsage: usage }];
          return usage;
        },
        loadSessionContextUsage: async (
          input: Parameters<CodexAppServerAdapter["loadSessionContextUsage"]>[0],
        ) => {
          policyBoundContextLoads.push(input);
          const usage = persistedContextUsage;
          snapshots = [
            {
              ...liveSnapshot(),
              ref: {
                repoPath: input.repoPath,
                runtimeKind: "codex",
                workingDirectory: input.workingDirectory,
                externalSessionId: input.externalSessionId,
              },
              contextUsage: usage,
            },
          ];
          return usage;
        },
        replyLiveApproval: async () => {
          const snapshot = snapshots[0];
          if (!snapshot) {
            throw new Error("Expected a retained Codex snapshot before replying to approval.");
          }
          snapshots = [
            {
              ...snapshot,
              activity: "running",
              pendingApprovals: [],
            },
          ];
        },
        replyLiveQuestion: async () => ({
          type: "assistant_part" as const,
          externalSessionId: "thread-1",
          timestamp: "2026-07-16T10:02:00.000Z",
          part: {
            kind: "tool" as const,
            messageId: "question-1",
            partId: "question-1",
            callId: "question-1",
            tool: "request_user_input",
            toolType: "question" as const,
            status: "completed" as const,
            input: {},
            output: "{}",
          },
        }),
        releaseRuntime: () => {
          snapshots = [];
          releaseRuntime();
        },
        startSession: async (input: unknown) => {
          controlInputs.starts.push(input);
          return controlSummary;
        },
        resumeSession: async (input: unknown) => {
          controlInputs.resumes.push(input);
          return controlSummary;
        },
        forkSession: async (input: unknown) => {
          controlInputs.forks.push(input);
          return controlSummary;
        },
        sendUserMessage: async (input: unknown) => {
          controlInputs.sends.push(input);
          return {
            type: "user_message" as const,
            externalSessionId: "thread-1",
            timestamp: "2026-07-16T10:02:00.000Z",
            messageId: "message-1",
            message: "Hello",
            parts: [{ kind: "text" as const, text: "Hello" }],
            state: "queued" as const,
          };
        },
        updateSessionModel: async () => {},
        stopSession: async () => {
          snapshots = [];
        },
        releaseSession: async () => {
          snapshots = [];
        },
      };
    },
    getOptions: () => {
      if (!options) {
        throw new Error("Controller was not created.");
      }
      return options;
    },
    rawEvents,
    liveContextLoads,
    policyBoundContextLoads,
    controlInputs,
  };
};

describe("createCodexLiveSessionAdapterPreparer", () => {
  test("interrupts an active Codex turn before releasing its live projection", async () => {
    const calls: unknown[] = [];
    const interruptingCodexAppServer = {
      ...codexAppServer,
      request: (input: Parameters<CodexAppServerPort["request"]>[0]) => {
        calls.push(input);
        if (input.method === "thread/read") {
          return Effect.succeed({
            thread: {
              id: "thread-1",
              cwd: "/repo/worktree",
              status: { type: "active", activeFlags: [] },
            },
          } as unknown as CodexAppServerRequestResult);
        }
        if (input.method === "thread/turns/list") {
          return Effect.succeed({
            data: [
              {
                id: "turn-1",
                startedAt: 1_778_112_001,
                completedAt: null,
                durationMs: null,
                error: null,
                items: [],
                itemsView: "summary",
                status: "running",
              },
            ],
            nextCursor: null,
            backwardsCursor: null,
          } as CodexAppServerRequestResult);
        }
        return Effect.succeed({} as CodexAppServerRequestResult);
      },
    } satisfies CodexAppServerPort;
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        codexAppServer: interruptingCodexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );

    await Effect.runPromise(prepared.adapter.stopSession(ref));

    expect(calls).toEqual([
      {
        runtimeId: "runtime-1",
        method: "thread/read",
        params: { threadId: "thread-1", includeTurns: false },
      },
      {
        runtimeId: "runtime-1",
        method: "thread/turns/list",
        params: {
          threadId: "thread-1",
          limit: 20,
          sortDirection: "desc",
          itemsView: "summary",
        },
      },
      {
        runtimeId: "runtime-1",
        method: "turn/interrupt",
        params: { threadId: "thread-1", turnId: "turn-1" },
      },
    ]);
    await expect(
      Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo")),
    ).resolves.toEqual([]);
  });

  test("resolves and injects Codex policy behind the normalized control boundary", async () => {
    const policyScopes: AgentSessionWorkflowScope[] = [];
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy: (scope) =>
          Effect.sync(() => {
            policyScopes.push(scope);
            return codexPolicy;
          }),
        createController: harness.createController,
      })(runtime),
    );
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };

    await Effect.runPromise(
      prepared.adapter.startSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        sessionScope,
        systemPrompt: "Build",
      }),
    );
    await Effect.runPromise(prepared.adapter.resumeSession({ ...ref, sessionScope }));
    await Effect.runPromise(
      prepared.adapter.forkSession({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        sessionScope,
        systemPrompt: "Build",
        parentExternalSessionId: "parent-1",
      }),
    );
    await Effect.runPromise(
      prepared.adapter.sendUserMessage({
        ...ref,
        sessionScope,
        parts: [{ kind: "text", text: "Hello" }],
      }),
    );

    expect(policyScopes).toEqual([sessionScope, sessionScope, sessionScope, sessionScope]);
    for (const inputs of Object.values(harness.controlInputs)) {
      expect(inputs).toEqual([
        expect.objectContaining({
          runtimeKind: "codex",
          sessionScope,
          runtimePolicy: { kind: "codex", policy: codexPolicy },
        }),
      ]);
    }
  });

  test("fails actionably when a direct Codex control omits workflow scope", async () => {
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );

    await expect(
      Effect.runPromise(
        prepared.adapter.sendUserMessage({
          ...ref,
          parts: [{ kind: "text", text: "Hello" }],
        } as never),
      ),
    ).rejects.toThrow("requires workflow session scope");
    expect(harness.controlInputs.sends).toEqual([]);
  });

  test("releases through the host lifecycle without re-entering its coordinator", async () => {
    const events: unknown[] = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      publish: (event) => events.push(event),
    });
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: service,
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
    await Effect.runPromise(prepared.startForwarding());
    await harness.getOptions().onLiveSessionMutation?.({
      runtimeId: "runtime-1",
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    await expect(
      Effect.runPromise(service.releaseRuntime("runtime-1").pipe(Effect.timeout("100 millis"))),
    ).resolves.toEqual([ref]);
    expect(events.at(-1)).toMatchObject({ type: "session_removed", ref });
    await expect(Effect.runPromise(service.list({ repoPath: "/repo" }))).resolves.toEqual([]);
  });

  test("clears the retained projection when controller cleanup fails", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness({
      initialSnapshots: [liveSnapshot()],
      releaseRuntime: () => {
        throw new Error("controller cleanup failed");
      },
    });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    await harness.getOptions().onLiveSessionMutation?.({
      runtimeId: "runtime-1",
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    await expect(Effect.runPromise(prepared.adapter.releaseRuntime())).rejects.toThrow(
      "controller cleanup failed",
    );

    await expect(
      Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo")),
    ).resolves.toEqual([]);
  });

  test("rehydrates three retained pending approvals in the first snapshot after renderer reload", async () => {
    const snapshots = Array.from({ length: 3 }, (_, index) => {
      const sessionNumber = index + 1;
      const snapshot = liveSnapshot();
      return {
        ...snapshot,
        ref: {
          ...snapshot.ref,
          externalSessionId: `thread-${sessionNumber}`,
        },
        title: `Live Codex session ${sessionNumber}`,
        pendingApprovals: snapshot.pendingApprovals.map((approval) => ({
          ...approval,
          requestId: `pending-opaque-${sessionNumber}`,
        })),
      } satisfies AgentSessionLiveSnapshot;
    });
    const events: unknown[] = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      publish: (event) => events.push(event),
    });
    const harness = createControllerHarness({ initialSnapshots: snapshots });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: service,
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
    await Effect.runPromise(prepared.startForwarding());
    await harness.getOptions().onLiveSessionMutation?.({
      runtimeId: "runtime-1",
      snapshots,
      transcriptEvents: [],
      catalogInvalidated: false,
    });

    events.length = 0;
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "snapshot",
      repoPath: "/repo",
      sessions: snapshots,
    });
    expect(harness.liveContextLoads).toEqual([]);
    expect(harness.policyBoundContextLoads).toEqual([]);
  });

  test("prepares observation before transport delivery and atomically forwards the first projection", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );

    prepared.emitRuntimeEvent({
      runtimeId: "runtime-1",
      kind: "notification",
      receivedAt: "2026-07-16T10:01:30.000Z",
      message: {
        method: "thread/status/changed",
        params: { threadId: "thread-1", status: { type: "idle" } },
      },
    });
    expect(harness.rawEvents).toHaveLength(1);

    const firstMutation = harness.getOptions().onLiveSessionMutation?.({
      runtimeId: "runtime-1",
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    await Promise.resolve();
    expect(changes).toEqual([]);

    await Effect.runPromise(prepared.startForwarding());
    await firstMutation;
    expect(changes).toEqual([{ type: "session_upsert", snapshot: liveSnapshot() }]);
    await expect(
      Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo")),
    ).resolves.toEqual([liveSnapshot()]);

    const removeMutation = harness.getOptions().onLiveSessionMutation?.({
      runtimeId: "runtime-1",
      snapshots: [],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    await removeMutation;
    expect(changes.at(-1)).toEqual({ type: "session_removed", ref });
  });

  test("rejects malformed transcript events without partially committing a mutation", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());

    await expect(
      harness.getOptions().onLiveSessionMutation?.({
        runtimeId: "runtime-1",
        snapshots: [liveSnapshot()],
        transcriptEvents: [{ type: "session_status" } as never],
        catalogInvalidated: false,
      }),
    ).rejects.toThrow("externalSessionId");
    expect(changes).toEqual([]);
    await expect(
      Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo")),
    ).resolves.toEqual([]);
  });

  test("reports a failed runtime event projection through the host background-failure boundary", async () => {
    const deliveredChanges: AgentSessionLiveAdapterChange[] = [];
    const deliveryFailure = new HostOperationError({
      operation: "test.live-session-lifecycle",
      message: "live session mutation delivery failed",
    });
    let resolveBackgroundFailure: (failure: HostOperationError) => void = () => undefined;
    const backgroundFailure = new Promise<HostOperationError>((resolve) => {
      resolveBackgroundFailure = resolve;
    });
    const lifecycle = {
      registerRuntimeAdapter: () => Effect.void,
      releaseRuntime: () => Effect.succeed([]),
      runAdapterMutation: <Success>(
        mutation: Effect.Effect<AgentSessionLiveAdapterMutation<Success>, HostError>,
      ) =>
        mutation.pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              deliveredChanges.push(...result.changes);
            }),
          ),
          Effect.zipRight(Effect.fail(deliveryFailure)),
        ),
    } satisfies RuntimeLiveSessionLifecyclePort;
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: lifecycle,
        codexAppServer,
        onBackgroundFailure: (failure) =>
          Effect.sync(() => {
            resolveBackgroundFailure(failure);
          }),
        resolveRuntimePolicy,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());

    prepared.emitRuntimeEvent({
      runtimeId: runtime.runtimeId,
      kind: "notification",
      receivedAt: "2026-07-16T10:01:30.000Z",
      message: {
        method: "thread/status/changed",
        params: { threadId: ref.externalSessionId, status: { type: "idle" } },
      },
    });

    const failure = await backgroundFailure;

    expect(failure).toMatchObject({
      _tag: "HostOperationError",
      operation: "codex-live-session.forward-mutation",
      details: { runtimeId: runtime.runtimeId },
    });
    expect(
      deliveredChanges.filter(
        (change) => change.type === "transcript_event" && change.event.type === "session_error",
      ),
    ).toEqual([]);
  });

  test("rejects fault refs outside the owning Codex projection and preserves an exact ref", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const onLiveSessionMutation = harness.getOptions().onLiveSessionMutation;

    await expect(
      onLiveSessionMutation?.({
        runtimeId: runtime.runtimeId,
        snapshots: [liveSnapshot()],
        transcriptEvents: [],
        catalogInvalidated: false,
        fault: "Codex event processing failed.",
        faultRef: { ...ref, repoPath: "/other-repo" },
      }),
    ).rejects.toThrow("fault ref outside repo");
    await expect(
      onLiveSessionMutation?.({
        runtimeId: runtime.runtimeId,
        snapshots: [liveSnapshot()],
        transcriptEvents: [],
        catalogInvalidated: false,
        fault: "Codex event processing failed.",
        faultRef: { ...ref, runtimeKind: "opencode" },
      }),
    ).rejects.toThrow("fault ref outside Codex runtime");
    expect(changes).toEqual([]);

    await expect(
      onLiveSessionMutation?.({
        runtimeId: runtime.runtimeId,
        snapshots: [liveSnapshot()],
        transcriptEvents: [],
        catalogInvalidated: false,
        fault: "Codex event processing failed.",
        faultRef: ref,
      }),
    ).resolves.toBeUndefined();
    expect(changes).toContainEqual({
      type: "fault",
      repoPath: runtime.repoPath,
      operation: "codex-live-session.process-event",
      message: "Codex event processing failed.",
      ref,
    });
  });

  test("drops an in-flight projection after runtime release", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    let allowMutation: () => void = () => undefined;
    let signalMutationStarted: () => void = () => undefined;
    const mutationBarrier = new Promise<void>((resolve) => {
      allowMutation = resolve;
    });
    const mutationStarted = new Promise<void>((resolve) => {
      signalMutationStarted = resolve;
    });
    const lifecycle = {
      registerRuntimeAdapter: () => Effect.void,
      releaseRuntime: () => Effect.succeed([]),
      runAdapterMutation: <Success>(
        mutation: Effect.Effect<AgentSessionLiveAdapterMutation<Success>, HostError>,
      ) =>
        Effect.gen(function* () {
          signalMutationStarted();
          yield* Effect.promise(() => mutationBarrier);
          const result = yield* mutation;
          changes.push(...result.changes);
          return result.value;
        }),
    } satisfies RuntimeLiveSessionLifecyclePort;
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: lifecycle,
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());

    const mutation = harness.getOptions().onLiveSessionMutation?.({
      runtimeId: "runtime-1",
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    await mutationStarted;
    await Effect.runPromise(prepared.adapter.releaseRuntime());
    allowMutation();
    await mutation;

    expect(changes).toEqual([]);
    await expect(
      Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo")),
    ).resolves.toEqual([]);
  });

  test("commits context and pending replies while leaving runtime removal to the lifecycle", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    await harness.getOptions().onLiveSessionMutation?.({
      runtimeId: "runtime-1",
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    changes.splice(0);

    await expect(Effect.runPromise(prepared.adapter.loadContext({ ...ref }))).resolves.toEqual({
      totalTokens: 123,
      contextWindow: 1_000,
    });
    expect(harness.liveContextLoads).toHaveLength(1);
    expect(harness.policyBoundContextLoads).toEqual([]);
    expect(changes.at(-1)).toMatchObject({
      type: "session_upsert",
      snapshot: { contextUsage: { totalTokens: 123, contextWindow: 1_000 } },
    });

    await Effect.runPromise(
      prepared.adapter.replyApproval({
        ...ref,
        requestId: "pending-opaque-1",
        outcome: "approve_once",
      }),
    );
    expect(changes.at(-1)).toMatchObject({
      type: "session_upsert",
      snapshot: { pendingApprovals: [] },
    });

    const changeCountBeforeRelease = changes.length;
    const releasedRefs = await Effect.runPromise(prepared.adapter.releaseRuntime());
    expect(releasedRefs).toEqual([ref]);
    expect(changes).toHaveLength(changeCountBeforeRelease);
    await expect(
      Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo")),
    ).resolves.toEqual([]);
  });

  test("returns nullable Codex context usage through the public host adapter", async () => {
    const harness = createControllerHarness({
      initialSnapshots: [liveSnapshot()],
      liveContextUsage: null,
    });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    await harness.getOptions().onLiveSessionMutation?.({
      runtimeId: "runtime-1",
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    await expect(Effect.runPromise(prepared.adapter.loadContext({ ...ref }))).resolves.toBeNull();
    expect(harness.liveContextLoads).toHaveLength(1);
  });

  test("loads an unmatched persisted session with host-resolved workflow policy", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness({ initialSnapshots: [] });
    const policyScopes: AgentSessionWorkflowScope[] = [];
    const qaPolicy: CodexEffectivePolicy = {
      ...codexPolicy,
      approvalPolicy: "never",
      approvalsReviewerApplies: false,
    };
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy: (scope) =>
          Effect.sync(() => {
            policyScopes.push(scope);
            return scope.role === "qa" ? qaPolicy : codexPolicy;
          }),
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const persistedRef = {
      ...ref,
      externalSessionId: "persisted-thread",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "qa" } as const,
    };

    await expect(Effect.runPromise(prepared.adapter.loadContext(persistedRef))).resolves.toEqual({
      totalTokens: 456,
      contextWindow: 2_000,
    });
    expect(policyScopes).toEqual([persistedRef.sessionScope]);
    expect(harness.liveContextLoads).toEqual([]);
    expect(harness.policyBoundContextLoads).toEqual([
      expect.objectContaining({
        ...persistedRef,
        runtimePolicy: { kind: "codex", policy: qaPolicy },
      }),
    ]);
    expect(changes.at(-1)).toMatchObject({
      type: "session_upsert",
      snapshot: {
        ref: expect.objectContaining({ externalSessionId: "persisted-thread" }),
        contextUsage: { totalTokens: 456, contextWindow: 2_000 },
      },
    });
  });

  test("returns nullable context for an unmatched persisted session", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness({
      initialSnapshots: [],
      persistedContextUsage: null,
    });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    const persistedRef = {
      ...ref,
      externalSessionId: "persisted-thread",
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" } as const,
    };
    await expect(Effect.runPromise(prepared.adapter.loadContext(persistedRef))).resolves.toBeNull();
    expect(harness.liveContextLoads).toEqual([]);
    expect(harness.policyBoundContextLoads).toEqual([
      expect.objectContaining({
        ...persistedRef,
        runtimePolicy: { kind: "codex", policy: codexPolicy },
      }),
    ]);
    expect(changes.at(-1)).toMatchObject({
      type: "session_upsert",
      snapshot: {
        ref: expect.objectContaining({ externalSessionId: "persisted-thread" }),
        contextUsage: null,
      },
    });
  });

  test("rejects an unmatched context load without workflow scope", async () => {
    const harness = createControllerHarness({ initialSnapshots: [] });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );

    await expect(
      Effect.runPromise(
        prepared.adapter.loadContext({ ...ref, externalSessionId: "persisted-thread" }),
      ),
    ).rejects.toThrow("requires workflow session scope");
    expect(harness.liveContextLoads).toEqual([]);
    expect(harness.policyBoundContextLoads).toEqual([]);
  });
});
