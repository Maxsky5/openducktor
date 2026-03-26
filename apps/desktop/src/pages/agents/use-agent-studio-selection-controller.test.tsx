import { describe, expect, mock, test } from "bun:test";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import {
  buildSessionsByTaskIdWithCache,
  useAgentStudioSelectionController,
} from "./use-agent-studio-selection-controller";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioSelectionController>[0];
const emptyCatalog = {
  providers: [],
  models: [],
  variants: [],
  profiles: [],
  defaultModelsByProvider: {},
};

const createTask = (id: string) => createTaskCardFixture({ id, title: id });

const createSession = (
  taskId: string,
  sessionId: string,
  overrides: Partial<ReturnType<typeof createAgentSessionFixture>> = {},
) =>
  createAgentSessionFixture({
    sessionId,
    externalSessionId: `ext-${sessionId}`,
    taskId,
    ...overrides,
  });

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioSelectionController, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeRepo: null,
  tasks: [createTask("task-1"), createTask("task-2")],
  isLoadingTasks: false,
  sessions: [],
  taskIdParam: "task-1",
  sessionParam: null,
  hasExplicitRoleParam: false,
  roleFromQuery: "spec",
  scenarioFromQuery: null,
  updateQuery: () => {},
  hydrateRequestedTaskSessionHistory: async () => {},
  readSessionModelCatalog: async () => emptyCatalog,
  readSessionTodos: async () => [],
  clearComposerInput: () => {},
  ...overrides,
});

describe("useAgentStudioSelectionController", () => {
  test("reuses cached task ordering metadata for unchanged task signatures", () => {
    const firstTaskOneOld = createSession("task-1", "session-old", {
      startedAt: "2026-02-22T10:00:00.000Z",
    });
    const firstTaskOneNew = createSession("task-1", "session-new", {
      startedAt: "2026-02-22T11:00:00.000Z",
    });
    const firstTaskTwo = createSession("task-2", "session-2-old", {
      startedAt: "2026-02-22T09:00:00.000Z",
    });

    const first = buildSessionsByTaskIdWithCache(
      [firstTaskOneOld, firstTaskOneNew, firstTaskTwo],
      new Map(),
    );

    expect(first.sessionsByTaskId.get("task-1")?.map((session) => session.sessionId)).toEqual([
      "session-new",
      "session-old",
    ]);

    const secondTaskOneOld = createSession("task-1", "session-old", {
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "running",
    });
    const secondTaskOneNew = createSession("task-1", "session-new", {
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "stopped",
    });
    const secondTaskTwoNew = createSession("task-2", "session-2-new", {
      startedAt: "2026-02-22T12:00:00.000Z",
    });

    const second = buildSessionsByTaskIdWithCache(
      [secondTaskOneOld, secondTaskOneNew, secondTaskTwoNew],
      first.nextCache,
    );

    expect(second.sessionsByTaskId.get("task-1")?.map((session) => session.sessionId)).toEqual([
      "session-new",
      "session-old",
    ]);
    expect(second.sessionsByTaskId.get("task-2")?.map((session) => session.sessionId)).toEqual([
      "session-2-new",
    ]);
  });

  test("keeps cache signature stable when task sessions arrive in a different order", () => {
    const sessionOld = createSession("task-1", "session-old", {
      startedAt: "2026-02-22T10:00:00.000Z",
    });
    const sessionNew = createSession("task-1", "session-new", {
      startedAt: "2026-02-22T11:00:00.000Z",
    });

    const first = buildSessionsByTaskIdWithCache([sessionOld, sessionNew], new Map());
    const second = buildSessionsByTaskIdWithCache([sessionNew, sessionOld], first.nextCache);

    expect(second.nextCache.get("task-1")?.inputSignature).toBe(
      first.nextCache.get("task-1")?.inputSignature,
    );
    expect(second.sessionsByTaskId.get("task-1")?.map((session) => session.sessionId)).toEqual([
      "session-new",
      "session-old",
    ]);
  });

  test("resolves task context from selected session when task param is missing", async () => {
    const session = createSession("task-2", "session-2");
    const harness = createHookHarness(
      createBaseArgs({
        sessions: [session],
        taskIdParam: "",
        sessionParam: "session-2",
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.taskId).toBe("task-2");
      expect(latest.selectedTask?.id).toBe("task-2");
      expect(latest.activeSession?.sessionId).toBe("session-2");
      expect(latest.viewTaskId).toBe("task-2");
      expect(latest.viewActiveSession?.sessionId).toBe("session-2");
    } finally {
      await harness.unmount();
    }
  });

  test("uses detached tab workflow default role instead of query role selection", async () => {
    const updateQuery = mock(() => {});
    const clearComposerInput = mock(() => {});
    const harness = createHookHarness(
      createBaseArgs({
        taskIdParam: "task-1",
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
        updateQuery,
        clearComposerInput,
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });

      const latest = harness.getLatest();
      expect(latest.viewTaskId).toBe("task-2");
      expect(latest.viewRole).toBe("build");
      expect(latest.viewScenario).toBe("build_implementation_start");
      expect(clearComposerInput).toHaveBeenCalledTimes(1);
      expect(updateQuery).toHaveBeenCalledTimes(1);
      expect(updateQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          task: "task-2",
          session: undefined,
          agent: undefined,
        }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("resolves view session from the UI-active task tab", async () => {
    const sessionTaskOne = createSession("task-1", "session-1", {
      role: "planner",
      scenario: "planner_initial",
      startedAt: "2026-02-22T12:00:00.000Z",
      status: "running",
    });
    const sessionTaskTwo = createSession("task-2", "session-2", {
      role: "qa",
      scenario: "qa_review",
      startedAt: "2026-02-22T13:00:00.000Z",
      status: "running",
    });

    const harness = createHookHarness(
      createBaseArgs({
        sessions: [sessionTaskOne, sessionTaskTwo],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().viewActiveSession?.sessionId).toBe("session-1");

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });

      const latest = harness.getLatest();
      expect(latest.viewTaskId).toBe("task-2");
      expect(latest.viewActiveSession?.sessionId).toBe("session-2");
      expect(latest.viewRole).toBe("qa");
      expect(latest.viewScenario).toBe("qa_review");
    } finally {
      await harness.unmount();
    }
  });

  test("tab shows working status when newer idle session exists but older session is running", async () => {
    const olderRunningSession = createSession("task-1", "session-old", {
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "running",
    });
    const newerIdleSession = createSession("task-1", "session-new", {
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        sessions: [olderRunningSession, newerIdleSession],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      const task1Tab = latest.taskTabs.find((tab) => tab.taskId === "task-1");
      expect(task1Tab?.status).toBe("working");
    } finally {
      await harness.unmount();
    }
  });

  test("idle session is included in latestSessionByTaskId for navigation", async () => {
    const idleSession = createSession("task-1", "session-idle", {
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        sessions: [idleSession],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      const task1Tab = latest.taskTabs.find((tab) => tab.taskId === "task-1");
      expect(task1Tab?.status).toBe("idle");
    } finally {
      await harness.unmount();
    }
  });

  test("defaults to build role for open task even when only optional-role session exists", async () => {
    const specSession = createSession("task-1", "session-spec", {
      role: "spec",
      scenario: "spec_initial",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const openTask = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "open",
      issueType: "task",
      agentWorkflows: {
        spec: { required: false, canSkip: true, available: true, completed: false },
        planner: { required: false, canSkip: true, available: true, completed: false },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: false, canSkip: true, available: false, completed: false },
      },
    });

    const harness = createHookHarness(
      createBaseArgs({
        tasks: [openTask, createTask("task-2")],
        sessions: [specSession],
        taskIdParam: "task-1",
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();
      const latest = harness.getLatest();

      expect(latest.viewActiveSession).toBeNull();
      expect(latest.viewRole).toBe("build");
      expect(latest.viewScenario).toBe("build_implementation_start");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps human_review task pinned to build session when newer qa session appears", async () => {
    const humanReviewTask = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "human_review",
    });
    const initialBuildSession = createSession("task-1", "session-build", {
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const newerQaSession = createSession("task-1", "session-qa", {
      role: "qa",
      scenario: "qa_review",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        tasks: [humanReviewTask, createTask("task-2")],
        sessions: [initialBuildSession],
        taskIdParam: "task-1",
        sessionParam: null,
        hasExplicitRoleParam: false,
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().viewActiveSession?.sessionId).toBe("session-build");
      expect(harness.getLatest().viewRole).toBe("build");

      await harness.update(
        createBaseArgs({
          tasks: [humanReviewTask, createTask("task-2")],
          sessions: [newerQaSession, initialBuildSession],
          taskIdParam: "task-1",
          sessionParam: null,
          hasExplicitRoleParam: false,
        }),
      );

      expect(harness.getLatest().viewActiveSession?.sessionId).toBe("session-build");
      expect(harness.getLatest().viewRole).toBe("build");
      expect(harness.getLatest().viewScenario).toBe("build_implementation_start");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps human_review view stable on query role changes when session is not explicit", async () => {
    const humanReviewTask = createTaskCardFixture({
      id: "task-1",
      title: "task-1",
      status: "human_review",
    });
    const buildSession = createSession("task-1", "session-build", {
      role: "build",
      scenario: "build_implementation_start",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const qaSession = createSession("task-1", "session-qa", {
      role: "qa",
      scenario: "qa_review",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        tasks: [humanReviewTask, createTask("task-2")],
        sessions: [qaSession, buildSession],
        taskIdParam: "task-1",
        sessionParam: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "build",
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().viewActiveSession?.sessionId).toBe("session-build");
      expect(harness.getLatest().viewRole).toBe("build");

      await harness.update(
        createBaseArgs({
          tasks: [humanReviewTask, createTask("task-2")],
          sessions: [qaSession, buildSession],
          taskIdParam: "task-1",
          sessionParam: null,
          hasExplicitRoleParam: false,
          roleFromQuery: "qa",
        }),
      );

      expect(harness.getLatest().viewActiveSession?.sessionId).toBe("session-build");
      expect(harness.getLatest().viewRole).toBe("build");
      expect(harness.getLatest().viewScenario).toBe("build_implementation_start");
    } finally {
      await harness.unmount();
    }
  });
});
