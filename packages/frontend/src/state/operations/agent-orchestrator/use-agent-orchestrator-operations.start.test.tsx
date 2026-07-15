import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  acceptedUserMessageForInput,
  BUILD_SELECTION,
  buildBootstrapFixture,
  createAgentSessionLiveSnapshotFixture,
  createDeferred,
  createHookHarness,
  createLiveSessionStreamFixture,
  createTestDependencies,
  createUnavailableBuildTaskFixture,
  host,
  listHarnessSessions,
  OPENCODE_RUNTIME_DESCRIPTOR,
  OpencodeSdkAdapter,
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

  test("sends through a host-hydrated live session without reattaching", async () => {
    let sendCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
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
    OpencodeSdkAdapter.prototype.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessageForInput(input);
    };
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

    const liveStream = createLiveSessionStreamFixture([createAgentSessionLiveSnapshotFixture()]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies({}, {}, liveStream.portOverrides),
    });

    try {
      await harness.mount();

      const sessionState = await harness.waitFor(
        (state) => listHarnessSessions(state).length === 1,
      );
      const session = listHarnessSessions(sessionState)[0];
      if (!session) {
        throw new Error("Expected loaded session");
      }

      await harness.run(async () => {
        await harness
          .getLatest()
          .operations.sendAgentMessage(session, [{ kind: "text", text: "hello" }]);
      });

      expect(liveStream.getObserveCount()).toBe(1);
      expect(sendCalls).toBe(1);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("keeps one ordered live-session attachment during startup loading", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    const liveStream = createLiveSessionStreamFixture([
      createAgentSessionLiveSnapshotFixture({
        title: "PLANNER task-1",
        activity: "running",
      }),
    ]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies({}, {}, liveStream.portOverrides),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => listHarnessSessions(state).length === 1);

      expect(liveStream.getObserveCount()).toBe(1);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
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
    OpencodeSdkAdapter.prototype.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessageForInput(input);
    };
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

    const unavailableTask = createUnavailableBuildTaskFixture();
    const liveStream = createLiveSessionStreamFixture([createAgentSessionLiveSnapshotFixture()]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [unavailableTask],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies({}, {}, liveStream.portOverrides),
    });

    try {
      await harness.mount();
      const sessionState = await harness.waitFor(
        (state) => listHarnessSessions(state).length === 1,
      );
      const session = listHarnessSessions(sessionState)[0];
      if (!session) {
        throw new Error("Expected loaded session");
      }

      await harness.run(async () => {
        await expect(
          harness
            .getLatest()
            .operations.sendAgentMessage(session, [{ kind: "text", text: "hello" }]),
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
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("reuses an in-memory session after it has been started", async () => {
    let startCalls = 0;
    let persistedListCalls = 0;
    let persistedSessions = [] as (typeof persistedSessionFixture)[];

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    const originalBuildStart = host.buildStart;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return persistedSessions;
    };
    host.agentSessionUpsert = async (_repoPath, _taskId, record) => {
      persistedSessions = [record];
    };
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

    OpencodeSdkAdapter.prototype.startSession = async (input) => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-in-memory",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      } as const;
    };
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
        const session = await harness.getLatest().operations.startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });
        firstSessionId = session.externalSessionId;
      });

      let secondSessionId = "";
      await harness.run(async () => {
        const session = await harness.getLatest().operations.startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "external-in-memory",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        });
        secondSessionId = session.externalSessionId;
      });

      expect(firstSessionId).toBe("external-in-memory");
      expect(secondSessionId).toBe("external-in-memory");
      expect(startCalls).toBe(1);
      expect(persistedListCalls).toBe(2);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      host.buildStart = originalBuildStart;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;

      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
    }
  });

  test("dedupes concurrent starts for the same repo and task", async () => {
    let startCalls = 0;
    let persistedListCalls = 0;
    let persistedSessions = [] as (typeof persistedSessionFixture)[];
    const startDeferred = createDeferred<{
      runtimeKind: "opencode";
      workingDirectory: string;
      externalSessionId: string;
      startedAt: string;
      role: "build";
      status: "idle";
    }>();

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    const originalBuildStart = host.buildStart;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return persistedSessions;
    };
    host.agentSessionUpsert = async (_repoPath, _taskId, record) => {
      persistedSessions = [record];
    };
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
    host.buildStart = async () => buildBootstrapFixture;

    OpencodeSdkAdapter.prototype.startSession = async () => {
      startCalls += 1;
      return startDeferred.promise;
    };
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
        const operations = harness.getLatest().operations;
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
          workingDirectory: "/tmp/repo/worktree",
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
      expect(persistedListCalls).toBeGreaterThanOrEqual(1);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      host.buildStart = originalBuildStart;

      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
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

    OpencodeSdkAdapter.prototype.startSession = async (input) => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
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

    const liveStream = createLiveSessionStreamFixture([createAgentSessionLiveSnapshotFixture()]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies({}, {}, liveStream.portOverrides),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        listHarnessSessions(state).some((entry) => entry.externalSessionId === "external-1"),
      );

      let externalSessionId = "";
      await harness.run(async () => {
        const session = await harness.getLatest().operations.startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "reuse",
          sourceSession: {
            externalSessionId: "external-1",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo/worktree",
          },
        });
        externalSessionId = session.externalSessionId;
      });

      expect(externalSessionId).toBe("external-1");
      expect(startCalls).toBe(0);
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

    OpencodeSdkAdapter.prototype.startSession = async (input) => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
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

      const startPromise = harness.getLatest().operations.startAgentSession({
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
