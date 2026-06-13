import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  BUILD_SELECTION,
  buildBootstrapFixture,
  createAgentSessionPresenceSnapshotFixture,
  createHookHarness,
  createUnavailableBuildTaskFixture,
  createWorktreeRuntimeFixture,
  host,
  OPENCODE_RUNTIME_DESCRIPTOR,
  OpencodeSdkAdapter,
  opencodeSdkAdapterPrototype,
  persistedSessionFixture,
  setupOrchestratorOperationsTestEnvironment,
  taskFixture,
  taskFixtureWithPersistedBuildSession,
} from "./use-agent-orchestrator-operations.test-helpers";

describe("use-agent-orchestrator-operations session state", () => {
  type SessionEventHandler = (event: { type: string; [key: string]: unknown }) => void;

  let restoreEnvironment: (() => void) | null = null;

  beforeEach(async () => {
    restoreEnvironment = await setupOrchestratorOperationsTestEnvironment();
  });

  afterEach(() => {
    restoreEnvironment?.();
    restoreEnvironment = null;
  });

  test("blocks free-form sends while a runtime error session is waiting for input", async () => {
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    let stopCalls = 0;
    let resumeCalls = 0;
    let sendCalls = 0;
    const eventHandlerRef: { current: SessionEventHandler | null } = { current: null };

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalStopSession = OpencodeSdkAdapter.prototype.stopSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
    const originalListLiveAgentSessionSnapshots = OpencodeSdkAdapter.prototype.listSessionPresence;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    OpencodeSdkAdapter.prototype.subscribeEvents = async (_externalSessionId, listener) => {
      subscribeCalls += 1;
      eventHandlerRef.current = listener as SessionEventHandler;
      return () => {
        unsubscribeCalls += 1;
      };
    };
    OpencodeSdkAdapter.prototype.stopSession = async () => {
      stopCalls += 1;
    };
    OpencodeSdkAdapter.prototype.resumeSession = async () => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    OpencodeSdkAdapter.prototype.sendUserMessage = async () => {
      sendCalls += 1;
    };
    opencodeSdkAdapterPrototype.listSessionPresence = async () => [
      createAgentSessionPresenceSnapshotFixture({
        ref: { externalSessionId: "external-1", workingDirectory: "/tmp/repo" },
        snapshot: {
          title: "SPEC task-1",
          status: { type: "idle" },
          pendingApprovals: [
            {
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["*.md"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
            },
          ],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [
                {
                  header: "Confirm",
                  question: "Confirm",
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
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();

      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1");
      });

      await expect(
        harness.run(async () => {
          await harness
            .getLatest()
            .sendAgentMessage("external-1", [{ kind: "text", text: "prime" }]);
        }),
      ).rejects.toThrow("Session is waiting for pending runtime input.");

      expect(eventHandlerRef.current).not.toBeNull();
      const registeredEventHandler = eventHandlerRef.current as SessionEventHandler;

      await harness.run(async () => {
        registeredEventHandler({
          type: "session_error",
          externalSessionId: "external-1",
          message: "boom",
          timestamp: "2026-02-22T08:00:04.000Z",
        });
        registeredEventHandler({
          type: "approval_required",
          externalSessionId: "external-1",
          requestId: "perm-1",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["*.md"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
          metadata: { tool: "read" },
          timestamp: "2026-02-22T08:00:05.000Z",
        });
        registeredEventHandler({
          type: "question_required",
          externalSessionId: "external-1",
          requestId: "question-1",
          questions: [
            {
              header: "Confirm",
              question: "Confirm",
              options: [],
              multiple: false,
              custom: false,
            },
          ],
          timestamp: "2026-02-22T08:00:05.500Z",
        });
      });

      const pendingState = await harness.waitFor(
        (state) =>
          state.sessions.find((entry) => entry.externalSessionId === "external-1")?.pendingApprovals
            .length === 1,
      );
      const pendingSession = pendingState.sessions.find(
        (entry) => entry.externalSessionId === "external-1",
      );
      expect(pendingSession?.pendingApprovals).toHaveLength(1);
      expect(pendingSession?.pendingQuestions).toHaveLength(1);

      const recoveredSession = harness
        .getLatest()
        .sessions.find((entry) => entry.externalSessionId === "external-1");
      expect(stopCalls).toBe(0);
      expect(resumeCalls).toBe(0);
      expect(subscribeCalls).toBeGreaterThan(0);
      expect(unsubscribeCalls).toBe(0);
      expect(sendCalls).toBe(0);
      expect(recoveredSession?.pendingApprovals).toHaveLength(1);
      expect(recoveredSession?.pendingQuestions).toHaveLength(1);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.stopSession = originalStopSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
      opencodeSdkAdapterPrototype.listSessionPresence = originalListLiveAgentSessionSnapshots;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("uses latest runs after args update when starting build sessions", async () => {
    let buildStartCalls = 0;
    let startWorkingDirectory = "";

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildStart = host.buildStart;
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

    host.agentSessionsList = async () => [];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    host.buildStart = async () => {
      buildStartCalls += 1;
      return buildBootstrapFixture;
    };
    host.workspaceGetRepoConfig = async () => ({
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
    });

    OpencodeSdkAdapter.prototype.startSession = async (input) => {
      startWorkingDirectory = input.workingDirectory;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-updated-runs",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    OpencodeSdkAdapter.prototype.subscribeEvents =
      async (_externalSessionId, _listener) => () => {};
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();

      await harness.run(async () => {
        await harness.getLatest().startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });
      });

      expect(buildStartCalls).toBe(0);
      expect(startWorkingDirectory).toBe(buildBootstrapFixture.workingDirectory);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.buildStart = originalBuildStart;
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;

      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
    }
  });

  test("uses latest tasks after args update when validating send permissions", async () => {
    let sendCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    OpencodeSdkAdapter.prototype.subscribeEvents = async () => () => {};
    OpencodeSdkAdapter.prototype.sendUserMessage = async () => {
      sendCalls += 1;
    };
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });

    const unavailableTask = createUnavailableBuildTaskFixture();

    try {
      await harness.mount();

      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1");
      });
      await harness.updateArgs({ tasks: [unavailableTask] });

      await harness.run(async () => {
        await expect(
          harness.getLatest().sendAgentMessage("external-1", [{ kind: "text", text: "hello" }]),
        ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
      });

      expect(sendCalls).toBe(0);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("reuses freshly loaded sessions without starting a new session", async () => {
    let startCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;

    host.agentSessionsList = async () => [
      {
        ...persistedSessionFixture,
        role: "build",
        workingDirectory: "/tmp/repo/worktree",
      },
    ];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    host.taskWorktreeGet = async () => ({
      workingDirectory: "/tmp/repo/worktree",
      source: "active_build_run",
    });

    OpencodeSdkAdapter.prototype.startSession = async () => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-unexpected",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();

      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1");
      });
      await harness.waitFor((state) =>
        state.sessions.some((entry) => entry.externalSessionId === "external-1"),
      );

      let reusedSessionId = "";
      await harness.run(async () => {
        reusedSessionId = await harness.getLatest().startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceExternalSessionId: "external-1",
        });
      });

      expect(reusedSessionId).toBe("external-1");
      expect(startCalls).toBe(0);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;

      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
    }
  });

  test("removeAgentSessions prunes only matching task roles from local state", async () => {
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [
      persistedSessionFixture,
      {
        ...persistedSessionFixture,
        externalSessionId: "external-spec",
        role: "spec",
      },
    ];

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1");
      });

      expect(
        harness
          .getLatest()
          .sessions.map((session) => session.externalSessionId)
          .sort(),
      ).toEqual(["external-1", "external-spec"]);

      await harness.run(async () => {
        harness.getLatest().removeAgentSessions({ taskId: "task-1", roles: ["build"] });
      });

      expect(harness.getLatest().sessions.map((session) => session.externalSessionId)).toEqual([
        "external-spec",
      ]);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
      await harness.unmount();
    }
  });

  test("removeAgentSession removes local session state", async () => {
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        harness.getLatest().commitSessions({
          "external-1": createAgentSessionFixture({
            externalSessionId: "external-1",
            taskId: "task-1",
            runtimeKind: "opencode",
            role: "build",
            workingDirectory: "/tmp/repo/worktree",
          }),
        });
      });

      await harness.run(async () => {
        await harness.getLatest().removeAgentSession("external-1");
      });

      expect(harness.getLatest().sessionStore.getSessionSnapshot("external-1")).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("revisit to the same repo refreshes task sessions again", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionsListBulk = host.agentSessionsListBulk;
    const originalRuntimeList = host.runtimeList;
    let persistedListCalls = 0;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [persistedSessionFixture];
    };
    host.agentSessionsListBulk = async () => ({
      "task-1": [persistedSessionFixture],
    });
    host.runtimeList = async () => [createWorktreeRuntimeFixture()];

    const harness = createHookHarness({
      activeRepo: "/tmp/repo-a",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.updateArgs({
        activeRepo: null,
        tasks: [],
      });
      await harness.updateArgs({
        activeRepo: "/tmp/repo-a",
        tasks: [taskFixtureWithPersistedBuildSession],
      });
      const hydrated = await harness.waitFor((state) => state.sessions.length === 1);
      expect(hydrated.sessions[0]?.externalSessionId).toBe("external-1");
      expect(persistedListCalls).toBe(0);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionsListBulk = originalAgentSessionsListBulk;
      host.runtimeList = originalRuntimeList;
    }
  });

  test("uses runtime presence for live agent sessions even when persisted records omit status", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalListSessionPresence = opencodeSdkAdapterPrototype.listSessionPresence;
    let subscribeCalls = 0;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    opencodeSdkAdapterPrototype.listSessionPresence = async () => [
      createAgentSessionPresenceSnapshotFixture({
        snapshot: {
          title: "BUILD task-1",
          workingDirectory: "/tmp/repo/worktree",
          status: { type: "busy" },
        },
      }),
    ];
    OpencodeSdkAdapter.prototype.subscribeEvents = async () => {
      subscribeCalls += 1;
      return () => {};
    };
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          historyPolicy: "none",
          persistedRecords: [persistedSessionFixture],
        });
      });
      const resolved = await harness.waitFor((state) =>
        state.sessions.some(
          (session) => session.externalSessionId === "external-1" && session.status === "running",
        ),
      );
      expect(
        resolved.sessions.find((session) => session.externalSessionId === "external-1")?.status,
      ).toBe("running");
      expect(subscribeCalls).toBe(1);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      opencodeSdkAdapterPrototype.listSessionPresence = originalListSessionPresence;
    }
  });

  test("scans but does not resume idle live agent sessions on repo refresh", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    let liveSnapshotScans = 0;
    let resumeCalls = 0;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4444",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    opencodeSdkAdapterPrototype.listSessionPresence = async () => {
      liveSnapshotScans += 1;
      return [
        createAgentSessionPresenceSnapshotFixture({
          ref: { externalSessionId: "external-1", workingDirectory: "/tmp/repo/worktree" },
          snapshot: { title: "BUILD task-1", status: { type: "idle" } },
        }),
      ];
    };
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.role,
        status: "idle",
      };
    };
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        state.sessions.some((session) => session.externalSessionId === "external-1"),
      );
      expect(liveSnapshotScans).toBe(1);
      expect(resumeCalls).toBe(0);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });
});
