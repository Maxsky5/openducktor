import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CodexAppServerAdapter } from "@openducktor/adapters-codex-app-server";
import { createAgentRuntimeServices } from "@/state/agent-runtime-services";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import { hasLoadedSessionHistory } from "./transcript/session-transcript-content";
import {
  acceptedUserMessageForInput,
  BUILD_SELECTION,
  buildBootstrapFixture,
  createAgentSessionLiveSnapshotFixture,
  createHookHarness,
  createLiveSessionStreamFixture,
  createTestDependencies,
  createUnavailableBuildTaskFixture,
  host,
  listHarnessSessions,
  OpencodeSdkAdapter,
  persistedSessionFixture,
  sessionMessagesToArray,
  setupOrchestratorOperationsTestEnvironment,
  taskFixture,
  taskFixtureWithPersistedBuildSession,
} from "./use-agent-orchestrator-operations.test-helpers";

describe("use-agent-orchestrator-operations session state", () => {
  let restoreEnvironment: (() => void) | null = null;

  beforeEach(async () => {
    restoreEnvironment = await setupOrchestratorOperationsTestEnvironment();
  });

  afterEach(() => {
    restoreEnvironment?.();
    restoreEnvironment = null;
  });

  test("exposes startup read-model failures as one load state", async () => {
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies({
        agentSessionsList: async () => {
          throw new Error("session store unavailable");
        },
        agentSessionsListForTasks: async () => {
          throw new Error("session store unavailable");
        },
      }),
    });

    try {
      await harness.mount();
      const latest = await harness.waitFor(
        (state) => state.readModelState.sessionReadModelLoadState.kind === "failed",
      );

      const readModelLoadState = latest.readModelState.sessionReadModelLoadState;
      expect(readModelLoadState.kind).toBe("failed");
      if (readModelLoadState.kind !== "failed") {
        throw new Error("Expected failed session read-model load state.");
      }
      expect(readModelLoadState.message).toContain("session store unavailable");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the repo session read model loading until task data is ready", async () => {
    let sessionListCalls = 0;

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      isLoadingTasks: true,
      refreshTaskData: async () => {},
      dependencies: createTestDependencies({
        agentSessionsListForTasks: async (_repoPath, taskIds) => {
          sessionListCalls += 1;
          return taskIds.map((taskId) => ({ taskId, agentSessions: [] }));
        },
      }),
    });

    try {
      await harness.mount();

      expect(harness.getLatest().readModelState.sessionReadModelLoadState).toEqual({
        kind: "loading",
        workspaceRepoPath: "/tmp/repo",
      });
      expect(sessionListCalls).toBe(0);

      await harness.updateArgs({
        tasks: [taskFixture],
        isLoadingTasks: false,
      });

      const latest = await harness.waitFor(
        (state) => state.readModelState.sessionReadModelLoadState.kind === "ready",
      );
      expect(latest.readModelState.sessionReadModelLoadState).toEqual({
        kind: "ready",
        workspaceRepoPath: "/tmp/repo",
      });
      expect(sessionListCalls).toBe(1);
    } finally {
      await harness.unmount();
    }
  });

  test("blocks free-form sends while the host snapshot reports pending input", async () => {
    let stopCalls = 0;
    let resumeCalls = 0;
    let sendCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalStopSession = OpencodeSdkAdapter.prototype.stopSession;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    OpencodeSdkAdapter.prototype.stopSession = async () => {
      stopCalls += 1;
    };
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
    };
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

    const liveSession = createAgentSessionLiveSnapshotFixture({
      activity: "waiting_for_permission",
      title: "SPEC task-1",
      pendingApprovals: [
        {
          requestId: "approval-occurrence-1",
          requestType: "permission_grant",
          title: "Approve permission: read",
          summary: "Approval request for read.",
          affectedPaths: ["*.md"],
          action: { name: "read" },
          mutation: "read_only",
          supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
        },
      ],
      pendingQuestions: [
        {
          requestId: "question-occurrence-1",
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
    });
    const liveStream = createLiveSessionStreamFixture([liveSession]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [persistedSessionFixture] },
          ],
        },
        {},
        liveStream.portOverrides,
      ),
    });

    try {
      await harness.mount();

      const loadedState = await harness.waitFor((state) => listHarnessSessions(state).length === 1);
      const session = listHarnessSessions(loadedState)[0];
      if (!session) {
        throw new Error("Expected loaded session");
      }

      const pendingState = await harness.waitFor(
        (state) =>
          listHarnessSessions(state).find((entry) => entry.externalSessionId === "external-1")
            ?.pendingApprovals.length === 1,
      );
      const pendingSession = listHarnessSessions(pendingState).find(
        (entry) => entry.externalSessionId === "external-1",
      );
      expect(pendingSession?.pendingApprovals).toHaveLength(1);
      expect(pendingSession?.pendingQuestions).toHaveLength(1);

      const recoveredSession = listHarnessSessions(harness.getLatest()).find(
        (entry) => entry.externalSessionId === "external-1",
      );

      await harness.run(async () => {
        await harness
          .getLatest()
          .operations.sendAgentMessage(session, [{ kind: "text", text: "blocked" }]);
      });

      expect(stopCalls).toBe(0);
      expect(resumeCalls).toBe(0);
      expect(sendCalls).toBe(0);
      expect(liveStream.getObserveCount()).toBe(1);
      expect(recoveredSession?.pendingApprovals).toHaveLength(1);
      expect(recoveredSession?.pendingQuestions).toHaveLength(1);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      OpencodeSdkAdapter.prototype.stopSession = originalStopSession;
      OpencodeSdkAdapter.prototype.resumeSession = originalResumeSession;
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
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
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;

    host.agentSessionsList = async () => [];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    const taskSessionBootstrapPrepare = async (
      _repoPath: string,
      _taskId: string,
      role: "spec" | "planner" | "build" | "qa",
      runtimeKind: "opencode" | "codex",
    ) => {
      buildStartCalls += 1;
      return { ...buildBootstrapFixture, bootstrapId: "bootstrap-latest", role, runtimeKind };
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
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-updated-runs",
        startedAt: "2026-02-22T08:00:00.000Z",
        role: "build",
        status: "idle",
      };
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
      dependencies: createTestDependencies(
        {
          agentSessionsList: async () => [],
          agentSessionUpsert: async () => undefined,
        },
        { taskSessionBootstrapPrepare },
      ),
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

      expect(buildStartCalls).toBe(1);
      expect(startWorkingDirectory).toBe(buildBootstrapFixture.workingDirectory);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;

      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
    }
  });

  test("uses latest tasks after args update when validating send permissions", async () => {
    let sendCalls = 0;

    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalSendUserMessage = OpencodeSdkAdapter.prototype.sendUserMessage;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
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

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies({
        agentSessionsList: async () => [persistedSessionFixture],
        agentSessionsListForTasks: async () => [
          { taskId: "task-1", agentSessions: [persistedSessionFixture] },
        ],
        agentSessionUpsert: async () => {},
      }),
    });

    const unavailableTask = createUnavailableBuildTaskFixture();

    try {
      await harness.mount();

      const loadedState = await harness.waitFor((state) => listHarnessSessions(state).length === 1);
      const session = listHarnessSessions(loadedState)[0];
      if (!session) {
        throw new Error("Expected loaded session");
      }
      await harness.updateArgs({ tasks: [unavailableTask] });

      await harness.run(async () => {
        await expect(
          harness
            .getLatest()
            .operations.sendAgentMessage(session, [{ kind: "text", text: "hello" }]),
        ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
      });

      expect(sendCalls).toBe(0);
    } finally {
      await harness.unmount();

      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      OpencodeSdkAdapter.prototype.sendUserMessage = originalSendUserMessage;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("persists explicit session model updates through the orchestrator commit boundary", async () => {
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalUpdateSessionModel = OpencodeSdkAdapter.prototype.updateSessionModel;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    const upsertedRecords: unknown[] = [];
    let storedSession = structuredClone(persistedSessionFixture);
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    OpencodeSdkAdapter.prototype.updateSessionModel = async () => {};
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
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(
        {
          agentSessionsList: async () => [storedSession],
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [storedSession] },
          ],
          agentSessionUpsert: async (_repoPath, _taskId, record) => {
            upsertedRecords.push(record);
            storedSession = record;
          },
        },
        {},
        liveStream.portOverrides,
      ),
    });

    try {
      await harness.mount();
      const loaded = await harness.waitFor((state) =>
        listHarnessSessions(state).some((session) => session.externalSessionId === "external-1"),
      );
      const session = listHarnessSessions(loaded).find(
        (entry) => entry.externalSessionId === "external-1",
      );
      if (!session) {
        throw new Error("Expected loaded session");
      }

      await harness.run(() => {
        harness.getLatest().operations.updateAgentSessionModel(session, BUILD_SELECTION);
      });
      const updated = await harness.waitFor((state) =>
        listHarnessSessions(state).some(
          (entry) =>
            entry.externalSessionId === "external-1" &&
            entry.selectedModel?.modelId === BUILD_SELECTION.modelId,
        ),
      );
      const updatedSession = listHarnessSessions(updated).find(
        (entry) => entry.externalSessionId === "external-1",
      );
      expect(updatedSession?.selectedModel).toEqual(BUILD_SELECTION);
      expect(upsertedRecords).toEqual([
        expect.objectContaining({
          externalSessionId: "external-1",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          selectedModel: BUILD_SELECTION,
        }),
      ]);
    } finally {
      await harness.unmount();
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      OpencodeSdkAdapter.prototype.updateSessionModel = originalUpdateSessionModel;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("reuses freshly loaded sessions without starting a new session", async () => {
    let startCalls = 0;

    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalBuildContinuationTargetGet = host.taskWorktreeGet;

    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;

    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
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
      dependencies: createTestDependencies({
        agentSessionsList: async () => [
          {
            ...persistedSessionFixture,
            role: "build",
            workingDirectory: "/tmp/repo/worktree",
          },
        ],
        agentSessionsListForTasks: async () => [
          {
            taskId: "task-1",
            agentSessions: [
              {
                ...persistedSessionFixture,
                role: "build",
                workingDirectory: "/tmp/repo/worktree",
              },
            ],
          },
        ],
        agentSessionUpsert: async () => {},
      }),
    });

    try {
      await harness.mount();

      await harness.waitFor((state) =>
        listHarnessSessions(state).some((entry) => entry.externalSessionId === "external-1"),
      );

      let reusedSessionId = "";
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
        reusedSessionId = session.externalSessionId;
      });

      expect(reusedSessionId).toBe("external-1");
      expect(startCalls).toBe(0);
    } finally {
      await harness.unmount();

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

  test("task session record query changes remove sessions whose durable records disappeared", async () => {
    const dependencies = createTestDependencies();
    dependencies.queryClient.setQueryData(agentSessionQueryKeys.list("/tmp/repo", "task-1"), [
      persistedSessionFixture,
      {
        ...persistedSessionFixture,
        externalSessionId: "external-spec",
        role: "spec",
      },
    ]);
    dependencies.queryClient.setQueryData(
      agentSessionQueryKeys.hydration("/tmp/repo", ["task-1"]),
      true,
    );
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies,
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => listHarnessSessions(state).length === 2);

      expect(
        listHarnessSessions(harness.getLatest())
          .map((session) => session.externalSessionId)
          .sort(),
      ).toEqual(["external-1", "external-spec"]);

      await harness.run(async () => {
        dependencies.queryClient.setQueryData(agentSessionQueryKeys.list("/tmp/repo", "task-1"), [
          {
            ...persistedSessionFixture,
            externalSessionId: "external-spec",
            role: "spec",
          },
        ]);
      });

      await harness.waitFor((state) =>
        listHarnessSessions(state).every((session) => session.externalSessionId !== "external-1"),
      );
      expect(
        listHarnessSessions(harness.getLatest()).map((session) => session.externalSessionId),
      ).toEqual(["external-spec"]);
    } finally {
      await harness.unmount();
    }
  });

  test("revisit to the same repo refreshes task sessions again", async () => {
    let persistedListCalls = 0;

    const harness = createHookHarness({
      activeRepo: "/tmp/repo-a",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies({
        agentSessionsListForTasks: async () => {
          persistedListCalls += 1;
          return [{ taskId: "task-1", agentSessions: [persistedSessionFixture] }];
        },
      }),
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
      const loaded = await harness.waitFor((state) => listHarnessSessions(state).length === 1);
      expect(listHarnessSessions(loaded)[0]?.externalSessionId).toBe("external-1");
      expect(persistedListCalls).toBe(1);
    } finally {
      await harness.unmount();
    }
  });

  test("uses the host live snapshot when persisted records omit status", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    OpencodeSdkAdapter.prototype.listAvailableModels = async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    });
    OpencodeSdkAdapter.prototype.loadSessionTodos = async () => [];
    OpencodeSdkAdapter.prototype.loadSessionHistory = async () => [];

    const liveStream = createLiveSessionStreamFixture([
      createAgentSessionLiveSnapshotFixture({
        activity: "running",
      }),
    ]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      runtimeHealthByRuntime: {
        opencode: createRepoRuntimeHealthFixture({ status: "ready" }),
      },
      refreshTaskData: async () => {},
      agentEngine: createAgentRuntimeServices().agentEngine,
      dependencies: createTestDependencies(
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [persistedSessionFixture] },
          ],
        },
        {},
        liveStream.portOverrides,
      ),
    });

    try {
      await harness.mount();
      const resolved = await harness.waitFor((state) =>
        listHarnessSessions(state).some(
          (session) => session.externalSessionId === "external-1" && session.status === "running",
        ),
      );
      expect(
        listHarnessSessions(resolved).find((session) => session.externalSessionId === "external-1")
          ?.status,
      ).toBe("running");
      expect(liveStream.getObserveCount()).toBe(1);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.agentSessionUpsert = originalAgentSessionUpsert;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("passes prompt context to Codex session history loads", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalCodexLoadSessionHistory = CodexAppServerAdapter.prototype.loadSessionHistory;
    const codexRecord = {
      ...persistedSessionFixture,
      runtimeKind: "codex" as const,
    };
    const receivedHistoryInputRef: {
      current:
        | Parameters<InstanceType<typeof CodexAppServerAdapter>["loadSessionHistory"]>[0]
        | null;
    } = { current: null };

    host.agentSessionsList = async () => [codexRecord];
    CodexAppServerAdapter.prototype.loadSessionHistory = async (input) => {
      receivedHistoryInputRef.current = input;
      return [
        {
          messageId: "history-system-1",
          role: "system",
          timestamp: input.systemPromptContext?.startedAt ?? codexRecord.startedAt,
          text: `System prompt:\n\n${input.systemPromptContext?.systemPrompt ?? ""}`,
          parts: [],
        },
      ];
    };

    const liveStream = createLiveSessionStreamFixture([
      createAgentSessionLiveSnapshotFixture({
        ref: {
          runtimeKind: "codex",
          externalSessionId: codexRecord.externalSessionId,
          workingDirectory: codexRecord.workingDirectory,
        },
        activity: "running",
      }),
    ]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      runtimeHealthByRuntime: {
        codex: createRepoRuntimeHealthFixture({ status: "ready" }),
      },
      refreshTaskData: async () => {},
      agentEngine: createAgentRuntimeServices().agentEngine,
      dependencies: createTestDependencies(
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [codexRecord] },
          ],
        },
        {},
        liveStream.portOverrides,
      ),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        listHarnessSessions(state).some(
          (session) => session.externalSessionId === codexRecord.externalSessionId,
        ),
      );
      await harness.run(async () => {
        await harness.getLatest().operations.loadAgentSessionHistory({
          externalSessionId: codexRecord.externalSessionId,
          runtimeKind: codexRecord.runtimeKind,
          workingDirectory: codexRecord.workingDirectory,
        });
      });
      const loaded = await harness.waitFor((state) =>
        listHarnessSessions(state).some(
          (session) =>
            session.externalSessionId === codexRecord.externalSessionId &&
            hasLoadedSessionHistory(session),
        ),
      );
      const session = listHarnessSessions(loaded).find(
        (entry) => entry.externalSessionId === codexRecord.externalSessionId,
      );
      const receivedHistoryInput = receivedHistoryInputRef.current;
      if (!receivedHistoryInput) {
        throw new Error("Expected startup history to be loaded.");
      }

      expect(receivedHistoryInput.systemPromptContext).toMatchObject({
        startedAt: codexRecord.startedAt,
        systemPrompt: expect.stringContaining("Task context"),
      });
      expect(
        session ? sessionMessagesToArray(session).map((message) => message.content) : [],
      ).toEqual([expect.stringContaining("System prompt:\n\n")]);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      CodexAppServerAdapter.prototype.loadSessionHistory = originalCodexLoadSessionHistory;
    }
  });

  test("attaches idle host live sessions without resuming them on repo refresh", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalAgentSessionUpsert = host.agentSessionUpsert;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalResumeSession = OpencodeSdkAdapter.prototype.resumeSession;
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = OpencodeSdkAdapter.prototype.loadSessionHistory;
    let resumeCalls = 0;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.agentSessionUpsert = async () => {};
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    OpencodeSdkAdapter.prototype.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        role: input.sessionScope?.role ?? null,
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

    const liveStream = createLiveSessionStreamFixture([createAgentSessionLiveSnapshotFixture()]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [persistedSessionFixture] },
          ],
        },
        {},
        liveStream.portOverrides,
      ),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        listHarnessSessions(state).some((session) => session.externalSessionId === "external-1"),
      );
      expect(liveStream.getObserveCount()).toBe(1);
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

  test("applies context returned for a persisted session outside the live projection", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const contextUsage = {
      totalTokens: 12_345,
      contextWindow: 200_000,
      providerId: "openai",
      modelId: "gpt-5",
    };
    let receivedContextInput: unknown = null;
    let contextReadCount = 0;
    let releaseContextRead: (() => void) | undefined;
    const contextReadGate = new Promise<void>((resolve) => {
      releaseContextRead = resolve;
    });

    host.agentSessionsList = async () => [persistedSessionFixture];
    const liveStream = createLiveSessionStreamFixture();
    const dependencies = createTestDependencies(
      {
        agentSessionsListForTasks: async () => [
          { taskId: "task-1", agentSessions: [persistedSessionFixture] },
        ],
      },
      {},
      {
        ...liveStream.portOverrides,
        agentSessionLiveLoadContext: async (input) => {
          contextReadCount += 1;
          receivedContextInput = input;
          await contextReadGate;
          return contextUsage;
        },
      },
    );
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
      dependencies,
    });

    try {
      await harness.mount();
      const loaded = await harness.waitFor((state) =>
        listHarnessSessions(state).some(
          (session) => session.externalSessionId === persistedSessionFixture.externalSessionId,
        ),
      );
      const persistedSession = listHarnessSessions(loaded).find(
        (session) => session.externalSessionId === persistedSessionFixture.externalSessionId,
      );
      if (!persistedSession) {
        throw new Error("Expected persisted session");
      }
      expect(persistedSession.contextUsage).toBeNull();

      await harness.run(async () => {
        const target = {
          externalSessionId: persistedSession.externalSessionId,
          runtimeKind: persistedSession.runtimeKind,
          workingDirectory: persistedSession.workingDirectory,
        };
        const firstLoad = harness.getLatest().operations.loadAgentSessionContext(target);
        const secondLoad = harness.getLatest().operations.loadAgentSessionContext(target);
        releaseContextRead?.();
        await Promise.all([firstLoad, secondLoad]);
      });

      expect(contextReadCount).toBe(1);
      expect(receivedContextInput).toEqual({
        repoPath: "/tmp/repo",
        externalSessionId: persistedSession.externalSessionId,
        runtimeKind: persistedSession.runtimeKind,
        workingDirectory: persistedSession.workingDirectory,
      });
      expect(
        listHarnessSessions(harness.getLatest()).find(
          (session) => session.externalSessionId === persistedSession.externalSessionId,
        )?.contextUsage,
      ).toEqual(contextUsage);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
    }
  });
});
