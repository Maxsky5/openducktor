import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { taskWorktreeQueryKeys, taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { terminalQueryKeys } from "@/state/queries/terminals";
import {
  acceptedUserMessageForInput,
  BUILD_SELECTION,
  createAgentSessionLiveSnapshotFixture,
  createHookHarness,
  createLiveSessionStreamFixture,
  createTestDependencies,
  createUnavailableBuildTaskFixture,
  host,
  listHarnessSessions,
  OpencodeSdkAdapter,
  persistedSessionFixture,
  setupOrchestratorOperationsTestEnvironment,
  taskFixture,
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

  test("successful workflow start clears a cached missing worktree for only its task", async () => {
    const dependencies = createTestDependencies();
    const keys = [null, taskFixture.updatedAt].map((taskVersion) =>
      taskWorktreeQueryKeys.taskWorktree({ repoPath: "/tmp/repo", taskId: "task-1", taskVersion }),
    );
    const otherKeys = [
      taskWorktreeQueryKeys.taskWorktree({ repoPath: "/tmp/repo", taskId: "task-2" }),
      taskWorktreeQueryKeys.taskWorktree({ repoPath: "/other/repo", taskId: "task-1" }),
    ];
    for (const key of [...keys, ...otherKeys]) dependencies.queryClient.setQueryData(key, null);
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies,
    });
    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().operations.startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });
      });
      for (const key of keys)
        expect(dependencies.queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      for (const key of otherKeys)
        expect(dependencies.queryClient.getQueryState(key)?.isInvalidated).toBe(false);
      await expect(
        dependencies.queryClient.fetchQuery(
          taskWorktreeQueryOptions({
            repoPath: "/tmp/repo",
            taskId: "task-1",
            hostClient: dependencies.hostPort,
          }),
        ),
      ).resolves.toEqual({ workingDirectory: "/tmp/repo/worktree" });
    } finally {
      await harness.unmount();
    }
  });

  test("successful workflow start reads the terminals of only its task again", async () => {
    const dependencies = createTestDependencies();
    const taskKey = terminalQueryKeys.task({ repoPath: "/tmp/repo", taskId: "task-1" });
    const otherKey = terminalQueryKeys.task({ repoPath: "/tmp/repo", taskId: "task-2" });
    for (const key of [taskKey, otherKey])
      dependencies.queryClient.setQueryData(key, { hostInstanceId: "host-1", terminals: [] });
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies,
    });
    try {
      await harness.mount();
      await harness.run(async () => {
        await harness.getLatest().operations.startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });
      });
      expect(dependencies.queryClient.getQueryState(taskKey)?.isInvalidated).toBe(true);
      expect(dependencies.queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("invalidates only the failed workflow task's worktree queries", async () => {
    const failure = new Error("workflow start failed");
    const dependencies = createTestDependencies(
      {},
      {
        agentSessionWorkflowLaunch: async () => {
          throw failure;
        },
      },
    );
    const failedKeys = [null, taskFixture.updatedAt].map((taskVersion) =>
      taskWorktreeQueryKeys.taskWorktree({ repoPath: "/tmp/repo", taskId: "task-1", taskVersion }),
    );
    const otherKeys = [
      taskWorktreeQueryKeys.taskWorktree({ repoPath: "/tmp/repo", taskId: "task-2" }),
      taskWorktreeQueryKeys.taskWorktree({ repoPath: "/other/repo", taskId: "task-1" }),
    ];
    for (const key of [...failedKeys, ...otherKeys]) {
      dependencies.queryClient.setQueryData(key, {
        workingDirectory: "/tmp/repo/worktree",
        source: "active_build_run",
      });
    }
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies,
    });
    try {
      await harness.mount();
      await harness.run(async () => {
        await expect(
          harness.getLatest().operations.startAgentSession({
            taskId: "task-1",
            role: "build",
            startMode: "fresh",
            selectedModel: BUILD_SELECTION,
          }),
        ).rejects.toBe(failure);
      });
      for (const key of failedKeys) {
        expect(dependencies.queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      }
      for (const key of otherKeys) {
        expect(dependencies.queryClient.getQueryState(key)?.isInvalidated).toBe(false);
      }
    } finally {
      await harness.unmount();
    }
  });

  test("sends immediately after preparation when the live stream has not delivered the new session", async () => {
    const originalSend = OpencodeSdkAdapter.prototype.sendUserMessage;
    let sends = 0;
    OpencodeSdkAdapter.prototype.sendUserMessage = async (input) => {
      sends += 1;
      return acceptedUserMessageForInput(input);
    };
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(),
    });
    try {
      await harness.mount();
      await harness.run(async () => {
        const session = await harness.getLatest().operations.startAgentSession({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        });
        await harness
          .getLatest()
          .operations.sendAgentMessage(session, [
            { kind: "text", text: "First interactive instruction" },
          ]);
      });
      expect(sends).toBe(1);
    } finally {
      await harness.unmount();
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSend;
    }
  });

  test("sends through a host-hydrated live session without reattaching", async () => {
    let sendCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
    const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
    const originalLoadRuntimeCatalog = OpencodeSdkAdapter.prototype.loadRuntimeCatalog;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [{ ...persistedSessionFixture }];
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
    OpencodeSdkAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

    const liveStream = createLiveSessionStreamFixture([createAgentSessionLiveSnapshotFixture()]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [{ ...persistedSessionFixture }] },
          ],
        },
        {},
        liveStream.portOverrides,
      ),
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
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
      OpencodeSdkAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("keeps one ordered live-session attachment during startup loading", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalLoadRuntimeCatalog = OpencodeSdkAdapter.prototype.loadRuntimeCatalog;

    host.agentSessionsList = async () => [{ ...persistedSessionFixture }];
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];
    OpencodeSdkAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
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
      dependencies: createTestDependencies(
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [{ ...persistedSessionFixture }] },
          ],
        },
        {},
        liveStream.portOverrides,
      ),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => listHarnessSessions(state).length === 1);

      expect(liveStream.getObserveCount()).toBe(1);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      OpencodeSdkAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
    }
  });

  test("sends to an existing session when its role is unavailable for new sessions", async () => {
    let sendCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
    const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
    const originalLoadRuntimeCatalog = OpencodeSdkAdapter.prototype.loadRuntimeCatalog;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [{ ...persistedSessionFixture }];
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
    OpencodeSdkAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

    const unavailableTask = createUnavailableBuildTaskFixture();
    const liveStream = createLiveSessionStreamFixture([createAgentSessionLiveSnapshotFixture()]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [unavailableTask],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [{ ...persistedSessionFixture }] },
          ],
        },
        {},
        liveStream.portOverrides,
      ),
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

      expect(sendCalls).toBe(1);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.taskWorktreeGet = originalBuildContinuationTargetGet;
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
      OpencodeSdkAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });
});
