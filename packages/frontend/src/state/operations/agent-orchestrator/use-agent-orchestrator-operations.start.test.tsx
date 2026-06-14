import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  BUILD_SELECTION,
  buildBootstrapFixture,
  createAgentSessionPresenceSnapshotFixture,
  createDeferred,
  createHookHarness,
  createTestDependencies,
  createUnavailableBuildTaskFixture,
  host,
  OPENCODE_RUNTIME_DESCRIPTOR,
  OpencodeSdkAdapter,
  opencodeSdkAdapterPrototype,
  persistedSessionFixture,
  setupOrchestratorOperationsTestEnvironment,
  taskFixture,
  toast,
} from "./use-agent-orchestrator-operations.test-helpers";

describe("use-agent-orchestrator-operations start and send", () => {
  let restoreEnvironment: (() => void) | null = null;

  beforeEach(async () => {
    restoreEnvironment = await setupOrchestratorOperationsTestEnvironment();
  });

  afterEach(() => {
    restoreEnvironment?.();
    restoreEnvironment = null;
  });

  test("keeps public operations stable across unchanged renders", async () => {
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(),
    });

    await harness.mount();
    try {
      const firstOperations = harness.getLatest().operations;

      await harness.updateArgs({});

      expect(harness.getLatest().operations).toBe(firstOperations);
    } finally {
      await harness.unmount();
    }
  });

  test("restarts listener before send when adapter session exists", async () => {
    let subscribeCalls = 0;
    let sendCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
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
    host.taskWorktreeGet = async () => ({
      workingDirectory: "/tmp/repo/worktree",
      source: "active_build_run",
    });
    OpencodeSdkAdapter.prototype.subscribeEvents = async (_externalSessionId, _listener) => {
      subscribeCalls += 1;
      return () => {};
    };
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

    try {
      await harness.mount();

      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1");
      });

      const sessionState = await harness.waitFor((state) => state.sessions.length === 1);
      const externalSessionId = sessionState.sessions[0]?.externalSessionId;
      if (!externalSessionId) {
        throw new Error("Expected loaded session id");
      }

      await harness.run(async () => {
        await harness
          .getLatest()
          .sendAgentMessage(externalSessionId, [{ kind: "text", text: "hello" }]);
      });

      expect(subscribeCalls).toBeGreaterThan(0);
      expect(sendCalls).toBe(1);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("does not add a duplicate session listener when the same live session is loaded twice", async () => {
    let subscribeCalls = 0;
    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalListSessionPresence = opencodeSdkAdapterPrototype.listSessionPresence;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    OpencodeSdkAdapter.prototype.subscribeEvents = async () => {
      subscribeCalls += 1;
      return () => {};
    };
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    opencodeSdkAdapterPrototype.listSessionPresence = async () => [
      createAgentSessionPresenceSnapshotFixture({
        snapshot: {
          title: "PLANNER task-1",
          workingDirectory: "/tmp/repo/worktree",
          status: { type: "busy" },
        },
      }),
    ];

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedSessionFixture],
        });
        await harness.getLatest().loadAgentSessions("task-1", {
          persistedRecords: [persistedSessionFixture],
        });
      });

      expect(subscribeCalls).toBe(1);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      opencodeSdkAdapterPrototype.listSessionPresence = originalListSessionPresence;
    }
  });

  test("shows error toast when send is rejected for an unavailable role", async () => {
    let sendCalls = 0;
    const toastError = mock(() => "");

    const originalToastError = toast.error;
    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    toast.error = toastError;
    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    host.taskWorktreeGet = async () => ({
      workingDirectory: "/tmp/repo/worktree",
      source: "active_build_run",
    });
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

    const unavailableTask = createUnavailableBuildTaskFixture();

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [unavailableTask],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().loadAgentSessions("task-1");
      });

      await harness.run(async () => {
        await expect(
          harness.getLatest().sendAgentMessage("external-1", [{ kind: "text", text: "hello" }]),
        ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
      });

      expect(sendCalls).toBe(0);
      expect(toastError).toHaveBeenCalledWith("Failed to send message", {
        description: "Role 'build' is unavailable for task 'task-1' in status 'open'.",
      });
    } finally {
      await harness.unmount();
      toast.error = originalToastError;
      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("reuses an in-memory session after it has been started", async () => {
    let startCalls = 0;
    let persistedListCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionsListBulk = host.agentSessionsListBulk;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    const originalBuildStart = host.buildStart;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };
    host.agentSessionsListBulk = async () => ({
      "task-1": [],
    });
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
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
    host.buildStart = async () => buildBootstrapFixture;
    host.taskWorktreeGet = async () => ({
      workingDirectory: "/tmp/repo/worktree",
    });

    OpencodeSdkAdapter.prototype.startSession = async () => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-in-memory",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      } as const;
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

      let firstSessionId = "";
      await harness.run(async () => {
        const session = await harness.getLatest().startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });
        firstSessionId = session.externalSessionId;
      });

      let secondSessionId = "";
      await harness.run(async () => {
        const session = await harness.getLatest().startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceExternalSessionId: "external-in-memory",
        });
        secondSessionId = session.externalSessionId;
      });

      expect(firstSessionId).toBe("external-in-memory");
      expect(secondSessionId).toBe("external-in-memory");
      expect(startCalls).toBe(1);
      expect(persistedListCalls).toBe(0);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionsListBulk = originalAgentSessionsListBulk;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      host.buildStart = originalBuildStart;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;

      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
    }
  });

  test("dedupes concurrent starts for the same repo and task", async () => {
    let startCalls = 0;
    let persistedListCalls = 0;
    const startDeferred = createDeferred<{
      runtimeKind: "opencode";
      externalSessionId: string;
      startedAt: string;
      role: "build";
      status: "idle";
    }>();

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionsListBulk = host.agentSessionsListBulk;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };
    host.agentSessionsListBulk = async () => ({
      "task-1": [],
    });
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    host.taskWorktreeGet = async () => ({
      workingDirectory: "/tmp/repo/worktree",
      source: "active_build_run",
    });
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

    OpencodeSdkAdapter.prototype.startSession = async () => {
      startCalls += 1;
      return startDeferred.promise;
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

      let firstSessionId = "";
      let secondSessionId = "";
      await harness.run(async () => {
        const operations = harness.getLatest();
        const firstStart = operations.startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });
        const secondStart = operations.startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });

        startDeferred.resolve({
          runtimeKind: "opencode",
          externalSessionId: "external-concurrent",
          startedAt: "2026-02-22T08:00:00.000Z",
          role: "build",
          status: "idle",
        });

        const [firstSession, secondSession] = await Promise.all([firstStart, secondStart]);
        firstSessionId = firstSession.externalSessionId;
        secondSessionId = secondSession.externalSessionId;
      });

      expect(firstSessionId).toBe("external-concurrent");
      expect(secondSessionId).toBe("external-concurrent");
      expect(startCalls).toBe(1);
      expect(persistedListCalls).toBe(0);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionsListBulk = originalAgentSessionsListBulk;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;

      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
    }
  });

  test("returns persisted session for task without starting a new one", async () => {
    let startCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalRuntimeEnsure = host.runtimeEnsure;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;

    host.agentSessionsList = async () => [
      {
        ...persistedSessionFixture,
        role: "build",
      },
    ];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    host.runtimeEnsure = async () => ({
      runtimeId: "runtime-1",
      kind: "opencode",
      repoPath: "/tmp/repo",
      taskId: null,
      role: "workspace",
      workingDirectory: "/tmp/repo/worktree",
      runtimeRoute: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4555",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    });
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
        role: "spec",
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

      let externalSessionId = "";
      await harness.run(async () => {
        const session = await harness.getLatest().startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceExternalSessionId: "external-1",
        });
        externalSessionId = session.externalSessionId;
      });

      expect(externalSessionId).toBe("external-1");
      expect(startCalls).toBe(0);
      await harness.waitFor((state) =>
        state.sessions.some((entry) => entry.externalSessionId === "external-1"),
      );
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.runtimeEnsure = originalRuntimeEnsure;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;

      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
    }
  });

  test("rejects stale start when active repo changes mid-flight", async () => {
    let startCalls = 0;
    const repoConfigDeferred =
      createDeferred<Awaited<ReturnType<typeof host.workspaceGetRepoConfig>>>();

    const originalAgentSessionsList = host.agentSessionsList;
    const originalBuildStart = host.buildStart;
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;

    host.agentSessionsList = async () => [];
    host.buildStart = async () => ({
      ...buildBootstrapFixture,
      workingDirectory: "/tmp/repo-a/worktree",
    });
    host.workspaceGetRepoConfig = async () => repoConfigDeferred.promise;

    OpencodeSdkAdapter.prototype.startSession = async () => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-should-not-start",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      } as const;
    };

    const harness = createHookHarness({
      activeRepo: "/tmp/repo-a",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
    });

    try {
      await harness.mount();

      const startPromise = harness.getLatest().startAgentSession({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });

      await harness.updateArgs({ activeRepo: "/tmp/repo-b" });
      repoConfigDeferred.resolve({
        workspaceId: "repo-a",
        workspaceName: "Repo A",
        repoPath: "/tmp/repo-a",
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

      let staleError: unknown = null;
      try {
        await startPromise;
      } catch (error) {
        staleError = error;
      }

      if (!(staleError instanceof Error)) {
        throw new Error("Expected stale start to reject with Error");
      }

      expect(staleError.message).toContain("Workspace changed while starting session.");
      expect(startCalls).toBe(0);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.buildStart = originalBuildStart;
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;

      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
    }
  });
});
