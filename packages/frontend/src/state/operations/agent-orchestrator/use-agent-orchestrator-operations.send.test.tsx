import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  acceptedUserMessageForInput,
  createAgentSessionLiveSnapshotFixture,
  createHookHarness,
  createLiveSessionStreamFixture,
  createTestDependencies,
  createUnavailableBuildTaskFixture,
  host,
  listHarnessSessions,
  AgentRuntimeTestAdapter,
  persistedSessionFixture,
  setupOrchestratorOperationsTestEnvironment,
  taskFixture,
} from "./use-agent-orchestrator-operations.test-helpers";

describe("use-agent-orchestrator-operations send", () => {
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
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
    const originalSendUserMessage = AgentRuntimeTestAdapter.prototype.sendUserMessage;
    const originalLoadRuntimeCatalog = AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog;
    const originalLoadSessionTodos = AgentRuntimeTestAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [{ ...persistedSessionFixture }];
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    host.taskWorktreeGet = async () => ({
      workingDirectory: "/tmp/repo/worktree",
      source: "active_build_run",
    });
    AgentRuntimeTestAdapter.prototype.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessageForInput(input);
    };
    AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
    });
    AgentRuntimeTestAdapter.prototype.loadSessionTodos = async () => [];
    AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => [];

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
      AgentRuntimeTestAdapter.prototype.sendUserMessage = originalSendUserMessage;
      AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
      AgentRuntimeTestAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("keeps one ordered live-session attachment during startup loading", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalLoadSessionTodos = AgentRuntimeTestAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;
    const originalLoadRuntimeCatalog = AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog;

    host.agentSessionsList = async () => [{ ...persistedSessionFixture }];
    AgentRuntimeTestAdapter.prototype.loadSessionTodos = async () => [];
    AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => [];
    AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = async () => ({
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
      AgentRuntimeTestAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
    }
  });

  test("sends to an existing session when its role is unavailable for new sessions", async () => {
    let sendCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;
    const originalSendUserMessage = AgentRuntimeTestAdapter.prototype.sendUserMessage;
    const originalLoadRuntimeCatalog = AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog;
    const originalLoadSessionTodos = AgentRuntimeTestAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [{ ...persistedSessionFixture }];
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    host.taskWorktreeGet = async () => ({
      workingDirectory: "/tmp/repo/worktree",
      source: "active_build_run",
    });
    AgentRuntimeTestAdapter.prototype.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessageForInput(input);
    };
    AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
    });
    AgentRuntimeTestAdapter.prototype.loadSessionTodos = async () => [];
    AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => [];

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
      AgentRuntimeTestAdapter.prototype.sendUserMessage = originalSendUserMessage;
      AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
      AgentRuntimeTestAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });
});
