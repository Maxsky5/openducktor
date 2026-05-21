import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReadSessionPresenceInput } from "./use-agent-orchestrator-operations.test-helpers";
import {
  clearAppQueryClient,
  createAgentSessionPresenceSnapshotFixture,
  createDeferred,
  createHookHarness,
  createSessionMessagesState,
  createTestDependencies,
  createWorktreeRuntimeFixture,
  host,
  OPENCODE_RUNTIME_DESCRIPTOR,
  OpencodeSdkAdapter,
  opencodeSdkAdapterPrototype,
  persistedBuildSessionFixture,
  sessionMessagesToArray,
  setupOrchestratorOperationsTestEnvironment,
  taskFixture,
  taskFixture2WithPersistedBuildSession,
  taskFixtureWithPersistedBuildSession,
  withSuppressedRendererWarning,
} from "./use-agent-orchestrator-operations.test-helpers";

describe("use-agent-orchestrator-operations runtime recovery", () => {
  let restoreEnvironment: (() => void) | null = null;

  beforeEach(async () => {
    restoreEnvironment = await setupOrchestratorOperationsTestEnvironment();
  });

  afterEach(() => {
    restoreEnvironment?.();
    restoreEnvironment = null;
  });

  test("tracks explicit runtime recovery state while reattaching a restored session runtime", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots = OpencodeSdkAdapter.prototype.listSessionPresence;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.runtimeList = async () => [];
    opencodeSdkAdapterPrototype.listSessionPresence = async () => [];
    let attachCalls = 0;
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [
      {
        messageId: "history-1",
        role: "assistant",
        timestamp: "2026-02-22T08:00:01.000Z",
        text: "Recovered history",
        parts: [
          {
            kind: "text",
            messageId: "history-1",
            partId: "part-1",
            text: "Recovered history",
            completed: true,
          },
        ],
      },
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
      return {
        runtimeKind: "opencode",
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        status: "running",
      };
    };
    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      attachCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        status: "running",
      };
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-1")?.runtimeRecoveryState,
      ).toBe("idle");

      host.runtimeList = async () => [];
      await clearAppQueryClient();

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-1")?.runtimeRecoveryState,
      ).toBe("waiting_for_runtime");

      host.runtimeList = async () => [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          repoPath: "/tmp/repo",
          taskId: null,
          role: "workspace",
          workingDirectory: "/tmp/repo/worktree",
          runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
          startedAt: "2026-02-22T08:00:00.000Z",
          descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
        },
      ];
      opencodeSdkAdapterPrototype.listSessionPresence = async () => [
        createAgentSessionPresenceSnapshotFixture({
          snapshot: {
            title: "BUILD task-1",
            workingDirectory: "/tmp/repo/worktree",
            status: { type: "busy" },
          },
        }),
      ];
      await clearAppQueryClient();
      attachCalls = 0;

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      const recoveredSession = harness.getLatest().sessionStore.getSessionSnapshot("external-1");
      expect(attachCalls).toBe(0);
      expect(recoveredSession?.runtimeRecoveryState).toBe("idle");
      expect(recoveredSession?.historyHydrationState).toBe("not_requested");
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      opencodeSdkAdapterPrototype.listSessionPresence = originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("keeps runtime recovery separate from requested history hydration", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots = OpencodeSdkAdapter.prototype.listSessionPresence;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    let loadSessionHistoryCalls = 0;

    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    opencodeSdkAdapterPrototype.listSessionPresence = async () => [
      createAgentSessionPresenceSnapshotFixture({
        snapshot: {
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          status: { type: "busy" },
        },
      }),
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
      runtimeKind: "opencode",
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.attachSession = async (input) => ({
      runtimeKind: "opencode",
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [
        {
          messageId: "history-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:01.000Z",
          text: "Recovered history",
          parts: [
            {
              kind: "text",
              messageId: "history-1",
              partId: "part-1",
              text: "Recovered history",
              completed: true,
            },
          ],
        },
      ];
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });
      await clearAppQueryClient();

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      expect(loadSessionHistoryCalls).toBe(0);
      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-1")?.historyHydrationState,
      ).toBe("not_requested");
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      opencodeSdkAdapterPrototype.listSessionPresence = originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("retries runtime transcript attachment after an attach failure clears the dedupe gate", async () => {
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
    const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
    const attachSessionCalls: Parameters<OpencodeSdkAdapter["attachSession"]>[0][] = [];
    let loadSessionHistoryCalls = 0;

    OpencodeSdkAdapter.prototype.hasSession = () => false;
    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      attachSessionCalls.push(input);

      if (attachSessionCalls.length === 1) {
        throw new Error("attach unavailable");
      }

      return {
        runtimeKind: "opencode",
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T09:00:00.000Z",
        role: input.role,
        status: "running",
      };
    };
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [
        {
          messageId: "history-subagent-1",
          role: "assistant",
          timestamp: "2026-02-22T09:00:01.000Z",
          text: "Subagent output",
          parts: [
            {
              kind: "text",
              messageId: "history-subagent-1",
              partId: "part-1",
              text: "Subagent output",
              completed: true,
            },
          ],
        },
      ];
    };
    OpencodeSdkAdapter.prototype.subscribeEvents = () => () => {};
    OpencodeSdkAdapter.prototype.detachSession = async () => {};

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(),
    });

    try {
      await harness.mount();

      await expect(
        harness.run(async () => {
          await harness.getLatest().operations.attachRuntimeTranscriptSession({
            repoPath: "/tmp/repo",
            externalSessionId: "external-subagent",
            runtimeKind: "opencode",
            runtimeId: "runtime-1",
            workingDirectory: "/tmp/repo/worktree",
          });
        }),
      ).rejects.toThrow("attach unavailable");

      expect(attachSessionCalls).toHaveLength(1);

      await harness.run(async () => {
        await harness.getLatest().operations.attachRuntimeTranscriptSession({
          repoPath: "/tmp/repo",
          externalSessionId: "external-subagent",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        });
      });

      expect(attachSessionCalls).toHaveLength(2);
      expect(loadSessionHistoryCalls).toBe(1);
    } finally {
      await harness.unmount();
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
      OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
    }
  });

  test("attaches runtime transcript sessions to existing live events without persisted prompt metadata", async () => {
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
    const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
    const attachSessionCalls: Parameters<OpencodeSdkAdapter["attachSession"]>[0][] = [];
    const subscribeExternalSessionIds: string[] = [];
    const operationOrder: string[] = [];
    const attachSessionDeferred =
      createDeferred<Awaited<ReturnType<OpencodeSdkAdapter["attachSession"]>>>();
    const agentSessionUpsert = mock(async () => {});
    let attachedSessionId: string | null = null;
    const listeners: Array<Parameters<OpencodeSdkAdapter["subscribeEvents"]>[1]> = [];

    OpencodeSdkAdapter.prototype.hasSession = (externalSessionId) =>
      externalSessionId === attachedSessionId;
    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      operationOrder.push("attach:start");
      attachSessionCalls.push(input);
      attachedSessionId = input.externalSessionId;
      const summary = await attachSessionDeferred.promise;
      operationOrder.push("attach:finish");
      return summary;
    };
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [
      {
        messageId: "history-subagent-1",
        role: "assistant",
        timestamp: "2026-02-22T09:00:01.000Z",
        text: "Subagent output",
        parts: [
          {
            kind: "text",
            messageId: "history-subagent-1",
            partId: "part-1",
            text: "Subagent output",
            completed: true,
          },
        ],
      },
    ];
    OpencodeSdkAdapter.prototype.subscribeEvents = (externalSessionId, nextListener) => {
      operationOrder.push("subscribe");
      if (!attachedSessionId) {
        throw new Error("subscribe before attach");
      }
      subscribeExternalSessionIds.push(externalSessionId);
      listeners.push(nextListener);
      return () => {};
    };
    OpencodeSdkAdapter.prototype.detachSession = async () => {};

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies({
        agentSessionUpsert,
      }),
    });

    try {
      await harness.mount();
      let attachPromise: Promise<void> | null = null;
      await harness.run(async () => {
        attachPromise = harness.getLatest().operations.attachRuntimeTranscriptSession({
          repoPath: "/tmp/repo",
          externalSessionId: "external-subagent",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        });
        await Promise.resolve();
      });

      expect(operationOrder).toEqual(["attach:start", "subscribe"]);
      const listener = listeners[0];
      if (!listener) {
        throw new Error("Expected transcript listener to be attached");
      }
      listener({
        type: "question_required",
        externalSessionId: "external-subagent",
        timestamp: "2026-02-22T09:00:01.500Z",
        requestId: "question-during-attach",
        questions: [
          {
            header: "Scope",
            question: "Which path should I inspect?",
            options: [{ label: "A", description: "Path A" }],
          },
        ],
      });
      attachSessionDeferred.resolve({
        runtimeKind: "opencode",
        externalSessionId: "external-subagent",
        startedAt: "2026-02-22T09:00:00.000Z",
        role: "build",
        status: "running",
      });
      await harness.run(async () => {
        await attachPromise;
      });

      expect(operationOrder).toEqual(["attach:start", "subscribe", "attach:finish"]);
      expect(subscribeExternalSessionIds).toEqual(["external-subagent"]);
      expect(attachSessionCalls).toHaveLength(1);
      expect(attachSessionCalls[0]).toMatchObject({
        externalSessionId: "external-subagent",
        purpose: "transcript",
        taskId: "",
        role: null,
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
        systemPrompt: "",
      });

      const transcriptSession = harness
        .getLatest()
        .sessionStore.getSessionSnapshot("external-subagent");
      expect(transcriptSession?.purpose).toBe("transcript");
      expect(transcriptSession?.taskId).toBe("");
      expect(transcriptSession?.role).toBeNull();
      expect(transcriptSession?.status).toBe("running");
      expect(transcriptSession?.pendingQuestions).toEqual([
        {
          requestId: "question-during-attach",
          questions: [
            {
              header: "Scope",
              question: "Which path should I inspect?",
              options: [{ label: "A", description: "Path A" }],
            },
          ],
        },
      ]);
      expect(
        transcriptSession
          ? sessionMessagesToArray(transcriptSession).some(
              (message) => message.content === "Subagent output",
            )
          : false,
      ).toBe(true);

      listener({
        type: "approval_required",
        externalSessionId: "external-subagent",
        timestamp: "2026-02-22T09:00:02.000Z",
        requestId: "permission-1",
        requestType: "permission_grant" as const,
        title: `Approve permission: ${"file.read"}`,
        summary: `Approval request for ${"file.read"}.`,
        affectedPaths: ["src/app.ts"],
        action: { name: "file.read" },
        mutation: "read_only" as const,
        supportedReplyOutcomes: [
          "approve_once" as const,
          "approve_session" as const,
          "reject" as const,
        ],
      });
      expect(agentSessionUpsert).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
      OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
    }
  });

  test("replaces stale local transcript state before attaching a new runtime transcript", async () => {
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
    const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
    const attachSessionCalls: Parameters<OpencodeSdkAdapter["attachSession"]>[0][] = [];
    const subscribedExternalSessionIds: string[] = [];

    OpencodeSdkAdapter.prototype.hasSession = () => false;
    OpencodeSdkAdapter.prototype.attachSession = async (input) => {
      attachSessionCalls.push(input);
      return {
        runtimeKind: "opencode",
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T09:00:00.000Z",
        role: input.role,
        status: "running",
      };
    };
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [
      {
        messageId: "history-new-subagent",
        role: "assistant",
        timestamp: "2026-02-22T09:00:01.000Z",
        text: "New subagent output",
        parts: [
          {
            kind: "text",
            messageId: "history-new-subagent",
            partId: "part-1",
            text: "New subagent output",
            completed: true,
          },
        ],
      },
    ];
    OpencodeSdkAdapter.prototype.subscribeEvents = (externalSessionId) => {
      subscribedExternalSessionIds.push(externalSessionId);
      return () => {};
    };
    OpencodeSdkAdapter.prototype.detachSession = async () => {
      throw new Error("stale local transcript replacement should not detach runtime sessions");
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        harness.getLatest().commitSessions({
          "external-subagent": {
            externalSessionId: "stale-external-subagent",
            taskId: "",
            repoPath: "/tmp/repo",
            runtimeKind: "opencode",
            role: null,
            status: "idle",
            startedAt: "2026-02-22T08:00:00.000Z",
            runtimeId: "stale-runtime",
            workingDirectory: "/tmp/repo/old-worktree",
            historyHydrationState: "hydrated",
            runtimeRecoveryState: "idle",
            purpose: "transcript",
            messages: createSessionMessagesState("external-subagent", []),
            draftAssistantText: "",
            draftAssistantMessageId: null,
            draftReasoningText: "",
            draftReasoningMessageId: null,
            contextUsage: null,
            pendingApprovals: [],
            pendingQuestions: [],
            todos: [],
            modelCatalog: null,
            selectedModel: null,
            isLoadingModelCatalog: false,
            promptOverrides: {},
          },
        });
      });

      await harness.run(async () => {
        await harness.getLatest().operations.attachRuntimeTranscriptSession({
          repoPath: "/tmp/repo",
          externalSessionId: "external-subagent",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        });
      });

      expect(attachSessionCalls).toHaveLength(1);
      expect(subscribedExternalSessionIds).toEqual(["external-subagent"]);

      const transcriptSession = harness
        .getLatest()
        .sessionStore.getSessionSnapshot("external-subagent");
      expect(transcriptSession).toMatchObject({
        purpose: "transcript",
        externalSessionId: "external-subagent",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
        status: "running",
      });
      expect(
        transcriptSession
          ? sessionMessagesToArray(transcriptSession).some(
              (message) => message.content === "New subagent output",
            )
          : false,
      ).toBe(true);
    } finally {
      await harness.unmount();
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
      OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
    }
  });

  test("detaches an in-flight runtime transcript attach when the local transcript closes", async () => {
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalHasSession = OpencodeSdkAdapter.prototype.hasSession;
    const originalDetachSession = OpencodeSdkAdapter.prototype.detachSession;
    const attachSessionDeferred =
      createDeferred<Awaited<ReturnType<OpencodeSdkAdapter["attachSession"]>>>();
    const detachExternalSessionIds: string[] = [];
    let loadSessionHistoryCalls = 0;
    let runtimeAttached = false;

    OpencodeSdkAdapter.prototype.attachSession = async (_input) => {
      runtimeAttached = true;
      const summary = await attachSessionDeferred.promise;
      runtimeAttached = true;
      return {
        ...summary,
        runtimeKind: "opencode",
      };
    };
    OpencodeSdkAdapter.prototype.hasSession = (externalSessionId) =>
      externalSessionId === "external-subagent" && runtimeAttached;
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [];
    };
    OpencodeSdkAdapter.prototype.detachSession = async (externalSessionId) => {
      detachExternalSessionIds.push(externalSessionId);
      runtimeAttached = false;
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      let attachPromise: Promise<void> | null = null;
      await harness.run(async () => {
        attachPromise = harness.getLatest().operations.attachRuntimeTranscriptSession({
          repoPath: "/tmp/repo",
          externalSessionId: "external-subagent",
          runtimeKind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/tmp/repo/worktree",
        });
        await Promise.resolve();
      });

      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-subagent"),
      ).not.toBeNull();

      await harness.run(async () => {
        await harness.getLatest().operations.removeAgentSession("external-subagent");
      });

      expect(harness.getLatest().sessionStore.getSessionSnapshot("external-subagent")).toBeNull();

      attachSessionDeferred.resolve({
        runtimeKind: "opencode",
        externalSessionId: "external-subagent",
        startedAt: "2026-02-22T09:00:00.000Z",
        role: "build",
        status: "running",
      });
      await harness.run(async () => {
        await attachPromise;
      });

      expect(loadSessionHistoryCalls).toBe(0);
      expect(detachExternalSessionIds).toEqual(["external-subagent", "external-subagent"]);
      expect(harness.getLatest().sessionStore.getSessionSnapshot("external-subagent")).toBeNull();
    } finally {
      await harness.unmount();
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.hasSession = originalHasSession;
      OpencodeSdkAdapter.prototype.detachSession = originalDetachSession;
    }
  });

  test("does not retry requested history hydration from runtime recovery", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots = OpencodeSdkAdapter.prototype.listSessionPresence;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    let loadSessionHistoryCalls = 0;

    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    opencodeSdkAdapterPrototype.listSessionPresence = async () => [
      createAgentSessionPresenceSnapshotFixture({
        snapshot: {
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          status: { type: "busy" },
        },
      }),
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
      runtimeKind: "opencode",
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.attachSession = async (input) => ({
      runtimeKind: "opencode",
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [
        {
          messageId: "history-retry-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "Retried history",
          parts: [
            {
              kind: "text",
              messageId: "history-retry-1",
              partId: "part-1",
              text: "Retried history",
              completed: true,
            },
          ],
        },
      ];
    };
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });
      const sessionsById = harness.getLatest().sessionStore.getSessionsByIdSnapshot();
      const failedSession = sessionsById["external-1"];
      if (!failedSession) {
        throw new Error("Expected session-1 to exist after bootstrapping persisted sessions");
      }
      harness.getLatest().sessionStore.setSessionsById({
        ...sessionsById,
        "external-1": {
          ...failedSession,
          historyHydrationState: "failed",
        },
      });
      await clearAppQueryClient();

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      expect(loadSessionHistoryCalls).toBe(0);
      expect(
        harness.getLatest().sessionStore.getSessionSnapshot("external-1")?.historyHydrationState,
      ).toBe("not_requested");
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      opencodeSdkAdapterPrototype.listSessionPresence = originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("keeps runtime recovery idle without coupling it to history hydration failures", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots = OpencodeSdkAdapter.prototype.listSessionPresence;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    opencodeSdkAdapterPrototype.listSessionPresence = async () => [
      createAgentSessionPresenceSnapshotFixture({
        snapshot: {
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          status: { type: "busy" },
        },
      }),
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
      runtimeKind: "opencode",
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.attachSession = async (input) => ({
      runtimeKind: "opencode",
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      throw new Error("history unavailable");
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });
      await clearAppQueryClient();

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      const recoveredSession = harness.getLatest().sessionStore.getSessionSnapshot("external-1");
      expect(recoveredSession?.runtimeRecoveryState).toBe("idle");
      expect(recoveredSession?.historyHydrationState).toBe("not_requested");
      expect(recoveredSession?.runtimeId).toBe("runtime-1");
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      opencodeSdkAdapterPrototype.listSessionPresence = originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("leaves local transcript tail untouched during runtime recovery", async () => {
    const originalRuntimeList = host.runtimeList;
    const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListLiveAgentSessionSnapshots = OpencodeSdkAdapter.prototype.listSessionPresence;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    let loadSessionHistoryCalls = 0;

    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    opencodeSdkAdapterPrototype.listSessionPresence = async () => [
      createAgentSessionPresenceSnapshotFixture({
        ref: { externalSessionId: "external-1", workingDirectory: "/tmp/repo/worktree" },
        snapshot: { title: "BUILD task-1", status: { type: "busy" } },
      }),
    ];
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => ({
      runtimeKind: "opencode",
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.attachSession = async (input) => ({
      runtimeKind: "opencode",
      externalSessionId: input.externalSessionId,
      startedAt: "2026-02-22T08:00:00.000Z",
      role: input.role,
      status: "running",
    });
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
      loadSessionHistoryCalls += 1;
      return [
        {
          messageId: "history-tail-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:04.000Z",
          text: "Recovered history tail",
          parts: [
            {
              kind: "text",
              messageId: "history-tail-1",
              partId: "part-1",
              text: "Recovered history tail",
              completed: true,
            },
          ],
        },
      ];
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      const sessionsById = harness.getLatest().sessionStore.getSessionsByIdSnapshot();
      const session = sessionsById["external-1"];
      if (!session) {
        throw new Error("Expected session-1 to exist after bootstrapping persisted sessions");
      }
      await harness.run(async () => {
        harness.getLatest().commitSessions({
          ...sessionsById,
          "external-1": {
            ...session,
            historyHydrationState: "failed",
            messages: createSessionMessagesState("external-1", [
              {
                id: "local-message-1",
                role: "assistant",
                content: "Local transcript still present",
                timestamp: "2026-02-22T08:00:03.000Z",
              },
            ]),
          },
        });
      });
      await clearAppQueryClient();

      await harness.run(async () => {
        await harness.getLatest().retrySessionRuntimeAttachment({
          taskId: "task-1",
          externalSessionId: "external-1",
          persistedRecords: [persistedBuildSessionFixture],
        });
      });

      expect(loadSessionHistoryCalls).toBe(0);
      const recoveredSession = harness.getLatest().sessionStore.getSessionSnapshot("external-1");
      expect(recoveredSession?.runtimeRecoveryState).toBe("idle");
      expect(recoveredSession?.historyHydrationState).toBe("failed");
      const recoveredContents = recoveredSession
        ? sessionMessagesToArray(recoveredSession).map((message) => message.content)
        : [];
      expect(recoveredContents).toContain("Local transcript still present");
      expect(recoveredContents).not.toContain("Recovered history tail");
    } finally {
      await harness.unmount();
      host.runtimeList = originalRuntimeList;
      OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      opencodeSdkAdapterPrototype.listSessionPresence = originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("retries background session bootstrap after a transient repo config load failure", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionUpsert = host.agentSessionUpsert;
      const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
      const originalRuntimeList = host.runtimeList;
      let repoConfigCalls = 0;
      host.agentSessionUpsert = async () => {};
      host.runtimeList = async () => [createWorktreeRuntimeFixture()];
      host.workspaceGetRepoConfig = async () => {
        repoConfigCalls += 1;
        if (repoConfigCalls === 1) {
          throw new Error("temporary repo config failure");
        }
        return {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/tmp/repo",
          defaultRuntimeKind: "opencode" as const,
          branchPrefix: "obp",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {
            providers: {},
          },
          hooks: {
            preStart: [],
            postComplete: [],
          },
          devServers: [],
          worktreeCopyPaths: [],
          promptOverrides: {},
          agentDefaults: {},
        };
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some((session) => session.externalSessionId === "external-1"),
        );
        expect(repoConfigCalls).toBe(0);
        expect(
          resolved.sessions.find((session) => session.externalSessionId === "external-1"),
        ).toBeDefined();
      } finally {
        await harness.unmount();
        host.agentSessionUpsert = originalAgentSessionUpsert;
        host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
        host.runtimeList = originalRuntimeList;
      }
    });
  });

  test("bootstraps task sessions from task metadata with one batched startup presence scan", async () => {
    await withSuppressedRendererWarning(async () => {
      const originalAgentSessionsList = host.agentSessionsList;
      const originalRuntimeList = host.runtimeList;
      const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
      const originalAttachSession = OpencodeSdkAdapter.prototype.attachSession;
      const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
      const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
      const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
      const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
      let persistedListCalls = 0;
      let runtimeListCalls = 0;
      let listPresenceCalls = 0;
      let readPresenceCalls = 0;
      let resumeCalls = 0;
      let attachCalls = 0;
      let subscribeCalls = 0;
      let modelCatalogCalls = 0;
      let todoCalls = 0;
      let historyCalls = 0;
      const listPresenceInputs: Array<{
        repoPath: string;
        runtimeKind: "opencode" | "codex";
        directories?: string[];
      }> = [];
      host.agentSessionsList = async () => {
        persistedListCalls += 1;
        return [];
      };
      host.runtimeList = async () => {
        runtimeListCalls += 1;
        return [createWorktreeRuntimeFixture()];
      };
      opencodeSdkAdapterPrototype.listSessionPresence = async (input) => {
        listPresenceCalls += 1;
        listPresenceInputs.push(input);
        return [
          createAgentSessionPresenceSnapshotFixture({
            ref: {
              repoPath: "/tmp/repo",
              runtimeKind: "opencode",
              workingDirectory: "/tmp/repo/worktree",
              externalSessionId: "external-2",
            },
            snapshot: {
              status: { type: "busy" },
              pendingApprovals: [
                {
                  requestId: "perm-2",
                  requestType: "permission_grant" as const,
                  title: "Approve permission: edit",
                  summary: "Approval request for edit.",
                  affectedPaths: ["src/file.ts"],
                  action: { name: "edit" },
                  mutation: "mutating" as const,
                  supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
                },
              ],
              pendingQuestions: [
                {
                  requestId: "question-2",
                  questions: [
                    {
                      header: "Confirm",
                      question: "Continue?",
                      options: [],
                      multiple: false,
                      custom: false,
                    },
                  ],
                },
              ],
            },
          }),
        ];
      };
      opencodeSdkAdapterPrototype.readSessionPresence = async (input: ReadSessionPresenceInput) => {
        readPresenceCalls += 1;
        return createAgentSessionPresenceSnapshotFixture({ ref: input });
      };
      OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
        resumeCalls += 1;
        return {
          runtimeKind: "opencode",
          externalSessionId: input.externalSessionId,
          startedAt: "2026-02-22T08:00:00.000Z",
          role: input.role,
          status: "running",
        };
      };
      OpencodeSdkAdapter.prototype.attachSession = async (input) => {
        attachCalls += 1;
        return {
          runtimeKind: "opencode",
          externalSessionId: input.externalSessionId,
          startedAt: "2026-02-22T08:00:00.000Z",
          role: input.role,
          status: "running",
        };
      };
      OpencodeSdkAdapter.prototype.subscribeEvents = () => {
        subscribeCalls += 1;
        return () => {};
      };
      OpencodeSdkAdapter.prototype.listAvailableModels = async () => {
        modelCatalogCalls += 1;
        return { models: [], defaultModelsByProvider: {}, profiles: [] };
      };
      OpencodeSdkAdapter.prototype.loadSessionTodos = async () => {
        todoCalls += 1;
        return [];
      };
      OpencodeSdkAdapter.prototype.loadSessionHistory = async () => {
        historyCalls += 1;
        return [];
      };

      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession, taskFixture2WithPersistedBuildSession],
        refreshTaskData: async () => {},
      });

      try {
        await harness.mount();
        const resolved = await harness.waitFor((state) =>
          state.sessions.some((session) => session.externalSessionId === "external-2"),
        );
        expect(resolved.sessions.map((session) => session.externalSessionId).sort()).toEqual([
          "external-1",
          "external-2",
        ]);
        const recoveredSession = resolved.sessions.find(
          (session) => session.externalSessionId === "external-2",
        );
        expect(recoveredSession?.pendingApprovals).toHaveLength(1);
        expect(recoveredSession?.pendingQuestions).toHaveLength(1);
        expect(persistedListCalls).toBe(0);
        expect(runtimeListCalls).toBe(0);
        expect(listPresenceCalls).toBe(1);
        expect(listPresenceInputs).toEqual([
          {
            repoPath: "/tmp/repo",
            runtimeKind: "opencode",
            directories: ["/tmp/repo/worktree"],
          },
        ]);
        expect(readPresenceCalls).toBe(0);
        expect(resumeCalls).toBe(1);
        expect(attachCalls).toBe(0);
        expect(subscribeCalls).toBe(1);
        expect(modelCatalogCalls).toBe(0);
        expect(todoCalls).toBe(0);
        expect(historyCalls).toBe(0);
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
        host.runtimeList = originalRuntimeList;
        OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
        OpencodeSdkAdapter.prototype.attachSession = originalAttachSession;
        OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
        OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
        OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
        OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    });
  });
});
