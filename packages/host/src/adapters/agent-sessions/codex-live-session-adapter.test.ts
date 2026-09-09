import { describe, expect, test } from "bun:test";
import type {
  CodexAppServerAdapter,
  CodexAppServerAdapterOptions,
  CodexLiveSessionLocator,
  CodexSessionContextUsage,
} from "@openducktor/adapters-codex-app-server";
import {
  type AgentSessionLiveSnapshot,
  type AgentSessionLiveEnvelope,
  type AgentSessionScope,
  type CodexEffectivePolicy,
  parseCodexAppServerRequestResult,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type CodexAppServerClientRequestMap,
  type CodexAppServerRequestMethod,
  type RuntimeInstanceSummary,
  type FileDiff,
} from "@openducktor/contracts";
import type {
  ForkAgentSessionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import { Cause, Effect, Exit, Fiber } from "effect";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import {
  type HostError,
  HostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterMutation,
} from "../../ports/agent-session-live-adapter-port";
import type { CodexAppServerPort } from "../../ports/codex-app-server-port";
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

const codexResult = <Method extends CodexAppServerRequestMethod>(
  method: Method,
  value: CodexAppServerClientRequestMap[Method]["result"],
) => parseCodexAppServerRequestResult(method, value);

const threadReadResult = (threadId: string, cwd: string) =>
  codexResult("thread/read", {
    thread: {
      id: threadId,
      extra: null,
      sessionId: threadId,
      forkedFromId: null,
      parentThreadId: null,
      preview: "Test thread",
      ephemeral: false,
      section: null,
      sectionEnteredAt: null,
      projectId: null,
      historyMode: "paginated",
      modelProvider: "openai",
      createdAt: 1,
      updatedAt: 1,
      recencyAt: 1,
      status: { type: "active", activeFlags: [] },
      path: null,
      cwd,
      cliVersion: "0.149.0-test",
      source: "appServer",
      canAcceptDirectInput: true,
      threadSource: null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [],
    },
  });

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

const resolveRuntimePolicy = (_scope: AgentSessionScope) => Effect.succeed(codexPolicy);

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
  settleGeneratedImages?: CodexAppServerAdapter["settleGeneratedImages"];
  initialSnapshots?: AgentSessionLiveSnapshot[];
  releaseRuntime?: () => void;
  liveContextUsage?: CodexSessionContextUsage | null;
  persistedContextUsage?: CodexSessionContextUsage | null;
  sessionDiffs?: FileDiff[];
};

type AgentControlInputs = {
  starts: StartAgentSessionInput[];
  resumes: ResumeAgentSessionInput[];
  forks: ForkAgentSessionInput[];
  sends: SendAgentUserMessageInput[];
};

const createControllerHarness = ({
  settleGeneratedImages = () => [],
  initialSnapshots = [liveSnapshot()],
  releaseRuntime = () => undefined,
  liveContextUsage = { totalTokens: 123, contextWindow: 1_000 },
  persistedContextUsage = { totalTokens: 456, contextWindow: 2_000 },
  sessionDiffs = [],
}: ControllerHarnessOptions = {}) => {
  let options: CodexAppServerAdapterOptions | null = null;
  let snapshots = initialSnapshots;
  const rawEvents: unknown[] = [];
  const liveContextLoads: unknown[] = [];
  const policyBoundContextLoads: unknown[] = [];
  const sessionDiffLoads: unknown[] = [];
  const controlInputs: AgentControlInputs = {
    starts: [],
    resumes: [],
    forks: [],
    sends: [],
  };
  const controlSummary = {
    externalSessionId: "thread-1",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo/worktree",
    title: "Live Codex session",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" } as const,
    startedAt: "2026-07-16T10:01:00.000Z",
    status: "running" as const,
  };
  return {
    createController: (nextOptions: CodexAppServerAdapterOptions) => {
      options = nextOptions;
      return {
        beginGeneratedImageBatch: async () => {
          throw new Error("Unexpected beginGeneratedImageBatch");
        },
        describeGeneratedImages: async () => {
          throw new Error("Unexpected describeGeneratedImages");
        },
        releaseGeneratedImageBatch: () => {
          throw new Error("Unexpected releaseGeneratedImageBatch");
        },
        resolveGeneratedImageSource: async () => {
          throw new Error("Unexpected generated image read");
        },
        settleGeneratedImages,
        prepareRuntime: async (runtimeId: string) => {
          await nextOptions.subscribeEvents?.(runtimeId, (event) => rawEvents.push(event));
        },
        listLiveSessionSnapshots: () => snapshots,
        loadLiveSessionContextUsage: async (input: CodexLiveSessionLocator) => {
          liveContextLoads.push(input);
          const usage = liveContextUsage;
          const snapshot = snapshots[0];
          if (!snapshot) {
            throw new Error("Expected a live Codex snapshot before loading context.");
          }
          snapshots = [{ ...snapshot, contextUsage: usage }];
          return usage;
        },
        loadSessionContextUsage: async (
          input: Parameters<CodexAppServerAdapter["loadSessionContextUsage"]>[0],
        ) => {
          policyBoundContextLoads.push(input);
          const usage = persistedContextUsage;
          const nextSnapshot: AgentSessionLiveSnapshot = {
            ...liveSnapshot(),
            ref: {
              repoPath: input.repoPath,
              runtimeKind: "codex",
              workingDirectory: input.workingDirectory,
              externalSessionId: input.externalSessionId,
            },
            contextUsage: usage,
          };
          if (input.sessionScope?.kind === "repository") {
            nextSnapshot.repositoryScope = input.sessionScope;
          }
          snapshots = [nextSnapshot];
          return usage;
        },
        loadSessionDiff: async (input: Parameters<CodexAppServerAdapter["loadSessionDiff"]>[0]) => {
          sessionDiffLoads.push(input);
          return sessionDiffs;
        },
        replyLiveApproval: async () => {
          const snapshot = snapshots[0];
          if (!snapshot) {
            throw new Error("Expected a live Codex snapshot before replying to approval.");
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
        startSession: async (input: StartAgentSessionInput) => {
          controlInputs.starts.push(input);
          return controlSummary;
        },
        resumeSession: async (input: ResumeAgentSessionInput) => {
          controlInputs.resumes.push(input);
          return controlSummary;
        },
        forkSession: async (input: ForkAgentSessionInput) => {
          controlInputs.forks.push(input);
          return controlSummary;
        },
        sendUserMessage: async (input: SendAgentUserMessageInput) => {
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
        updateSessionModel: async (
          input: Parameters<CodexAppServerAdapter["updateSessionModel"]>[0],
        ) => {
          snapshots = snapshots.map((snapshot) => {
            if (snapshot.ref.externalSessionId !== input.externalSessionId) return snapshot;
            const updated = { ...snapshot };
            if (input.model) updated.model = input.model;
            else delete updated.model;
            return updated;
          });
        },
        stopSession: async () => {
          snapshots = [];
        },
        releaseSession: async (input: Parameters<CodexAppServerAdapter["releaseSession"]>[0]) => {
          snapshots = snapshots.filter(
            (snapshot) => snapshot.ref.externalSessionId !== input.externalSessionId,
          );
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
    sessionDiffLoads,
    controlInputs,
  };
};

describe("createCodexLiveSessionAdapterPreparer", () => {
  test("preserves a control model change through text deltas and removes only the released session", async () => {
    const originalModel = { providerId: "openai", modelId: "gpt-5", variant: "medium" };
    const nextModel = { ...originalModel, variant: "high" };
    const initial = { ...liveSnapshot(), model: originalModel };
    const idle = {
      ...liveSnapshot(),
      ref: { ...ref, externalSessionId: "idle-thread" },
      activity: "idle" as const,
      pendingApprovals: [],
    };
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness({ initialSnapshots: [initial, idle] });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation.");
        },
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());
    if (!prepared.adapter.supportsSessionControl)
      throw new Error("Expected Codex session controls.");
    const adapter = prepared.adapter;
    const onMutation = harness.getOptions().onLiveSessionMutation;
    if (!onMutation) throw new Error("Expected Codex mutation callback.");
    const changed = { ...initial, model: nextModel };
    try {
      await onMutation({
        runtimeId: runtime.runtimeId,
        snapshotMode: "full",
        snapshots: [initial, idle],
        transcriptEvents: [],
        catalogInvalidated: false,
      });
      expect(await Effect.runPromise(adapter.listSnapshots("/repo"))).toEqual([initial, idle]);
      changes.length = 0;
      await Effect.runPromise(
        adapter.updateSessionModel({
          ...ref,
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          model: nextModel,
        }),
      );
      expect(changes).toEqual([{ type: "session_upsert", snapshot: changed }]);
      changes.length = 0;
      for (const delta of ["first", "second", "third"]) {
        await onMutation({
          runtimeId: runtime.runtimeId,
          snapshotMode: "delta",
          snapshots: [],
          removedRefs: [],
          catalogInvalidated: false,
          transcriptEvents: [
            {
              type: "assistant_delta",
              sessionRef: ref,
              externalSessionId: ref.externalSessionId,
              timestamp: "2026-07-16T10:02:00.000Z",
              messageId: "message-1",
              channel: "text",
              delta,
            },
          ],
        });
      }
      expect(changes.map((change) => change.type)).toEqual([
        "transcript_event",
        "transcript_event",
        "transcript_event",
      ]);
      expect(
        changes.flatMap((change) =>
          change.type === "transcript_event" && change.event.type === "assistant_delta"
            ? [change.event.delta]
            : [],
        ),
      ).toEqual(["first", "second", "third"]);
      expect(await Effect.runPromise(adapter.listSnapshots("/repo"))).toEqual([changed, idle]);
      changes.length = 0;
      await Effect.runPromise(adapter.releaseSession(ref));
      expect(changes).toEqual([{ type: "session_removed", ref }]);
      expect(await Effect.runPromise(adapter.readSnapshot(ref))).toEqual({ type: "missing", ref });
      await onMutation({
        runtimeId: runtime.runtimeId,
        snapshotMode: "delta",
        snapshots: [],
        removedRefs: [],
        transcriptEvents: [],
        catalogInvalidated: false,
      });
      expect(await Effect.runPromise(adapter.listSnapshots("/repo"))).toEqual([idle]);
    } finally {
      await Effect.runPromise(prepared.discard());
    }
  });

  test("exposes the controller's streamed session diff through the host adapter", async () => {
    const sessionDiffs = [
      {
        file: "src/app.ts",
        type: "modified",
        additions: 1,
        deletions: 1,
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      },
    ];
    const harness = createControllerHarness({ sessionDiffs });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
        liveSessionLifecycle: createLifecycle([]),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );

    const loadSessionDiff = prepared.adapter.loadSessionDiff;
    expect(loadSessionDiff).toBeDefined();
    if (!loadSessionDiff) {
      throw new Error("Codex host adapter is missing loadSessionDiff.");
    }
    await expect(
      Effect.runPromise(loadSessionDiff({ ...ref, runtimeHistoryAnchor: "turn-1" })),
    ).resolves.toEqual(sessionDiffs);
    expect(harness.sessionDiffLoads).toEqual([{ ...ref, runtimeHistoryAnchor: "turn-1" }]);
  });

  test("interrupts an active Codex turn before releasing its live projection", async () => {
    const calls: unknown[] = [];
    const interruptingCodexAppServer = {
      ...codexAppServer,
      request: (input: Parameters<CodexAppServerPort["request"]>[0]) => {
        calls.push(input);
        if (input.method === "thread/read") {
          return Effect.succeed(threadReadResult("thread-1", "/repo/worktree"));
        }
        if (input.method === "thread/turns/list") {
          return Effect.succeed(
            codexResult("thread/turns/list", {
              data: [
                {
                  id: "turn-1",
                  startedAt: 1_778_112_001,
                  completedAt: null,
                  durationMs: null,
                  error: null,
                  items: [],
                  itemsView: "summary",
                  status: "inProgress",
                },
              ],
              nextCursor: null,
              backwardsCursor: null,
            }),
          );
        }
        return Effect.succeed(codexResult("turn/interrupt", {}));
      },
    } satisfies CodexAppServerPort;
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
    await expect(Effect.runPromise(prepared.adapter.listSnapshots("/repo"))).resolves.toEqual([]);
  });

  test("resolves and injects Codex policy behind the normalized control boundary", async () => {
    const policyScopes: AgentSessionScope[] = [];
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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

  test("requires scope and accepts repository scope for direct Codex controls", async () => {
    const harness = createControllerHarness();
    const policyScopes: AgentSessionScope[] = [];
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
        liveSessionLifecycle: createLifecycle([]),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy: (scope) => {
          policyScopes.push(scope);
          return Effect.succeed(codexPolicy);
        },
        createController: harness.createController,
      })(runtime),
    );

    await expect(
      Effect.runPromise(
        // @ts-expect-error Deliberately omit sessionScope to verify the adapter boundary.
        prepared.adapter.sendUserMessage({
          ...ref,
          parts: [{ kind: "text", text: "Hello" }],
        }),
      ),
    ).rejects.toThrow("Codex live-session control 'send-user-message' requires session scope.");
    await Effect.runPromise(
      prepared.adapter.sendUserMessage({
        ...ref,
        sessionScope: { kind: "repository" },
        parts: [{ kind: "text", text: "Hello" }],
      }),
    );
    expect(policyScopes).toEqual([{ kind: "repository" }]);
    expect(harness.controlInputs.sends).toEqual([
      expect.objectContaining({
        sessionScope: { kind: "repository" },
        runtimePolicy: { kind: "codex", policy: codexPolicy },
      }),
    ]);
  });

  test("releases through the host lifecycle without re-entering its coordinator", async () => {
    const events: AgentSessionLiveEnvelope[] = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      publish: (event) => events.push(event),
    });
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
      snapshotMode: "delta",
      removedRefs: [],
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

  test("invalidates catalogs at repo scope when Codex reports changed skills", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(prepared.startForwarding());

    await harness.getOptions().onLiveSessionMutation?.({
      runtimeId: runtime.runtimeId,
      snapshotMode: "delta",
      removedRefs: [],
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: true,
    });

    expect(changes).toContainEqual({
      type: "catalog_invalidated",
      repoPath: "/repo",
      runtimeKind: "codex",
    });
  });

  test("clears the current projection when controller cleanup fails", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness({
      initialSnapshots: [liveSnapshot()],
      releaseRuntime: () => {
        throw new Error("controller cleanup failed");
      },
    });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
      snapshotMode: "delta",
      removedRefs: [],
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    await expect(Effect.runPromise(prepared.adapter.releaseRuntime())).rejects.toThrow(
      "controller cleanup failed",
    );

    await expect(Effect.runPromise(prepared.adapter.listSnapshots("/repo"))).resolves.toEqual([]);
  });

  test("rehydrates three current pending approvals in the first snapshot after renderer reload", async () => {
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
    const events: AgentSessionLiveEnvelope[] = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      publish: (event) => events.push(event),
    });
    const harness = createControllerHarness({ initialSnapshots: snapshots });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
      snapshotMode: "delta",
      removedRefs: [],
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
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
      snapshotMode: "delta",
      removedRefs: [],
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    await Promise.resolve();
    expect(changes).toEqual([]);

    await Effect.runPromise(prepared.startForwarding());
    await firstMutation;
    expect(changes).toEqual([{ type: "session_upsert", snapshot: liveSnapshot() }]);
    await expect(Effect.runPromise(prepared.adapter.listSnapshots("/repo"))).resolves.toEqual([
      liveSnapshot(),
    ]);

    const removeMutation = harness.getOptions().onLiveSessionMutation?.({
      runtimeId: "runtime-1",
      snapshotMode: "delta",
      removedRefs: [ref],
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
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
        snapshotMode: "delta",
        removedRefs: [],
        snapshots: [liveSnapshot()],
        transcriptEvents: [
          // @ts-expect-error This malformed event verifies contract validation before commit.
          { type: "session_status" },
        ],
        catalogInvalidated: false,
      }),
    ).rejects.toThrow("externalSessionId");
    expect(changes).toEqual([]);
    await expect(Effect.runPromise(prepared.adapter.listSnapshots("/repo"))).resolves.toEqual([]);
  });

  test("reports a failed runtime event projection through the host background-failure boundary", async () => {
    const deliveredChanges: AgentSessionLiveAdapterChange[] = [];
    const deliveryFailure = new HostOperationError({
      operation: "test.live-session-lifecycle",
      message: "live session mutation delivery failed",
    });
    const backgroundFailures: HostOperationErrorAggregate[] = [];
    let resolveBackgroundFailure: (failure: HostOperationErrorAggregate) => void = () => undefined;
    const backgroundFailure = new Promise<HostOperationErrorAggregate>((resolve) => {
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
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
        liveSessionLifecycle: lifecycle,
        codexAppServer,
        onBackgroundFailure: (failure) =>
          Effect.sync(() => {
            backgroundFailures.push(failure);
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

    expect(backgroundFailures).toEqual([failure]);
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
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
        snapshotMode: "delta",
        removedRefs: [],
        snapshots: [liveSnapshot()],
        transcriptEvents: [],
        catalogInvalidated: false,
        fault: "Codex event processing failed.",
        faultRef: { ...ref, repoPath: "/other-repo" },
      }),
    ).rejects.toThrow("faultRef outside repo");
    await expect(
      onLiveSessionMutation?.({
        runtimeId: runtime.runtimeId,
        snapshotMode: "delta",
        removedRefs: [],
        snapshots: [liveSnapshot()],
        transcriptEvents: [],
        catalogInvalidated: false,
        fault: "Codex event processing failed.",
        faultRef: { ...ref, runtimeKind: "opencode" },
      }),
    ).rejects.toThrow("faultRef outside Codex runtime");
    expect(changes).toEqual([]);

    await expect(
      onLiveSessionMutation?.({
        runtimeId: runtime.runtimeId,
        snapshotMode: "delta",
        removedRefs: [],
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
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
      snapshotMode: "delta",
      removedRefs: [],
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    await mutationStarted;
    await Effect.runPromise(prepared.adapter.releaseRuntime());
    allowMutation();
    await mutation;

    expect(changes).toEqual([]);
    await expect(Effect.runPromise(prepared.adapter.listSnapshots("/repo"))).resolves.toEqual([]);
  });

  test("commits context and pending replies while leaving runtime removal to the lifecycle", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createControllerHarness();
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
      snapshotMode: "delta",
      removedRefs: [],
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
    await expect(Effect.runPromise(prepared.adapter.listSnapshots("/repo"))).resolves.toEqual([]);
  });

  test("returns nullable Codex context usage through the public host adapter", async () => {
    const harness = createControllerHarness({
      initialSnapshots: [liveSnapshot()],
      liveContextUsage: null,
    });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
      snapshotMode: "delta",
      removedRefs: [],
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
    const policyScopes: AgentSessionScope[] = [];
    const qaPolicy: CodexEffectivePolicy = {
      ...codexPolicy,
      approvalPolicy: "never",
      approvalsReviewerApplies: false,
    };
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
        liveSessionLifecycle: createLifecycle(changes),
        codexAppServer,
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy: (scope) =>
          Effect.sync(() => {
            policyScopes.push(scope);
            return scope.kind === "workflow" && scope.role === "qa" ? qaPolicy : codexPolicy;
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
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
      sessionScope: { kind: "repository" } as const,
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
        repositoryScope: { kind: "repository" },
        contextUsage: null,
      },
    });
  });

  test("rejects an unmatched context load without session scope", async () => {
    const harness = createControllerHarness({ initialSnapshots: [] });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
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
    ).rejects.toThrow("requires session scope");
    expect(harness.liveContextLoads).toEqual([]);
    expect(harness.policyBoundContextLoads).toEqual([]);
  });
});

for (const action of ["stop", "release", "runtime"] as const) {
  test(`publishes settled image output before ${action} removes the session`, async () => {
    const events: AgentSessionLiveEnvelope[] = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      publish: (event) => events.push(event),
    });
    const harness = createControllerHarness({
      settleGeneratedImages: () => [
        {
          type: "assistant_part",
          externalSessionId: ref.externalSessionId,
          sessionRef: ref,
          timestamp: "2026-07-16T10:02:00.000Z",
          part: {
            kind: "image_generation",
            messageId: "image",
            partId: "image",
            itemId: "image",
            status: "incomplete",
            incompleteReason: "turn_ended",
          },
        },
      ],
    });
    const prepared = await Effect.runPromise(
      createCodexLiveSessionAdapterPreparer({
        prepareImageGenerations: async () => {
          throw new Error("Unexpected image preparation");
        },
        liveSessionLifecycle: service,
        codexAppServer: {
          ...codexAppServer,
          request: () => {
            const result = threadReadResult(ref.externalSessionId, ref.workingDirectory);
            result.thread.status = { type: "idle" };
            return Effect.succeed(result);
          },
        },
        onBackgroundFailure: noBackgroundFailure,
        resolveRuntimePolicy,
        createController: harness.createController,
      })(runtime),
    );
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
    await Effect.runPromise(prepared.startForwarding());
    await harness.getOptions().onLiveSessionMutation?.({
      runtimeId: runtime.runtimeId,
      snapshotMode: "full",
      snapshots: [liveSnapshot()],
      transcriptEvents: [],
      catalogInvalidated: false,
    });
    events.length = 0;
    const operation =
      action === "runtime"
        ? service.releaseRuntime(runtime.runtimeId)
        : action === "stop"
          ? prepared.adapter.stopSession(ref)
          : prepared.adapter.releaseSession(ref);
    await Effect.runPromise(operation.pipe(Effect.asVoid, Effect.timeout("1 second")));
    const settled = events.findIndex((event) => event.type === "transcript_event");
    const removed = events.findIndex((event) => event.type === "session_removed");
    expect(settled).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(settled);
  });
}

for (const action of ["stop", "release"] as const) {
  for (const cleanupFails of [false, true]) {
    test(`${action} cleans up after image publication fails, cleanup failure: ${cleanupFails}`, async () => {
      const changes: AgentSessionLiveAdapterChange[] = [];
      let cleaned = false;
      const harness = createControllerHarness({
        settleGeneratedImages: () => [
          {
            type: "image_generation_settled",
            externalSessionId: ref.externalSessionId,
            sessionRef: ref,
            timestamp: "2026-07-16T10:02:00.000Z",
            reason: "turn_ended",
          },
        ],
      });
      const lifecycle = createLifecycle(changes);
      const prepared = await Effect.runPromise(
        createCodexLiveSessionAdapterPreparer({
          prepareImageGenerations: async () => {
            throw new Error("Unexpected image preparation");
          },
          liveSessionLifecycle: {
            ...lifecycle,
            runAdapterMutation: (mutation) =>
              lifecycle.runAdapterMutation(
                mutation.pipe(
                  Effect.flatMap((result) =>
                    result.changes.some((change) => change.type === "transcript_event")
                      ? Effect.fail(
                          new HostOperationError({
                            operation: "test.publish",
                            message: "Settlement publication failed",
                          }),
                        )
                      : Effect.succeed(result),
                  ),
                ),
              ),
          },
          codexAppServer: {
            ...codexAppServer,
            request: () => {
              const result = threadReadResult(ref.externalSessionId, ref.workingDirectory);
              result.thread.status = { type: "idle" };
              return Effect.succeed(result);
            },
          },
          onBackgroundFailure: noBackgroundFailure,
          resolveRuntimePolicy,
          createController: (options) => {
            const controller = harness.createController(options);
            return {
              ...controller,
              [action === "stop" ? "stopSession" : "releaseSession"]: async () => {
                cleaned = true;
                await controller.releaseSession(ref);
                if (cleanupFails) throw new Error("Controller cleanup failed");
              },
            };
          },
        })(runtime),
      );
      await Effect.runPromise(prepared.startForwarding());
      const result = await Effect.runPromiseExit(
        action === "stop"
          ? prepared.adapter.stopSession(ref)
          : prepared.adapter.releaseSession(ref),
      );
      expect(cleaned).toBe(true);
      expect(changes.some((change) => change.type === "session_removed")).toBe(true);
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        expect(Cause.pretty(result.cause)).toContain("Settlement publication failed");
        if (cleanupFails) expect(Cause.pretty(result.cause)).toContain("Controller cleanup failed");
      }
      await Effect.runPromise(prepared.discard());
    });
  }
}

test("interrupting an image read aborts the controller's preparation signal", async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const harness = createControllerHarness();
  const prepared = await Effect.runPromise(
    createCodexLiveSessionAdapterPreparer({
      prepareImageGenerations: async () => {
        throw new Error("Unexpected image preparation");
      },
      liveSessionLifecycle: createLifecycle([]),
      codexAppServer,
      onBackgroundFailure: noBackgroundFailure,
      resolveRuntimePolicy,
      createController: (options) => ({
        ...harness.createController(options),
        resolveGeneratedImageSource: async (_input, signal) => {
          if (!signal) throw new Error("Missing image read signal");
          started.resolve(signal);
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          );
          throw new Error("Unexpected image read completion");
        },
      }),
    })(runtime),
  );
  const fiber = Effect.runFork(
    prepared.adapter.resolveGeneratedImageSource({ ref, itemId: "image", revision: "revision" }),
  );
  try {
    const signal = await started.promise;
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(signal.aborted).toBe(true);
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(prepared.discard());
  }
});
