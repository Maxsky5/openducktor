import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createHookHarness as createSharedHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

type UseAgentStudioSelectionControllerHook =
  typeof import("./use-agent-studio-selection-controller")["useAgentStudioSelectionController"];
type BuildSessionsByTaskIdWithCacheFn =
  typeof import("./use-agent-studio-selection-controller")["buildSessionsByTaskIdWithCache"];

let useAgentStudioSelectionController: UseAgentStudioSelectionControllerHook;
let buildSessionsByTaskIdWithCache: BuildSessionsByTaskIdWithCacheFn;

const sessionByIdRef: { current: Record<string, AgentSessionState> } = {
  current: {},
};

type HookArgs = Parameters<UseAgentStudioSelectionControllerHook>[0];
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
  externalSessionId: string,
  overrides: Partial<ReturnType<typeof createAgentSessionFixture>> = {},
) =>
  createAgentSessionFixture({
    externalSessionId,
    taskId,
    ...overrides,
  });

const syncSessionLookup = (sessions: HookArgs["sessions"]): void => {
  sessionByIdRef.current = Object.fromEntries(
    sessions
      .filter((session): session is AgentSessionState => "messages" in session)
      .map((session) => [session.externalSessionId, session]),
  );
};

const createHookHarness = (initialProps: HookArgs) => {
  syncSessionLookup(initialProps.sessions);
  const harness = createSharedHookHarness(useAgentStudioSelectionController, initialProps);

  return {
    ...harness,
    update: async (nextProps: HookArgs) => {
      syncSessionLookup(nextProps.sessions);
      await harness.update(nextProps);
    },
  };
};

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: null,
  isRepoNavigationBoundaryPending: false,
  agentStudioReadinessState: "ready",
  tasks: [createTask("task-1"), createTask("task-2")],
  isLoadingTasks: false,
  sessions: [],
  taskIdParam: "task-1",
  sessionParam: null,
  hasExplicitRoleParam: false,
  roleFromQuery: "spec",
  selectionIntent: null,
  updateQuery: () => {},
  hydrateRequestedTaskSessionHistory: async () => {},
  ensureSessionReadyForView: async () => false,
  runtimeAttachmentSources: [],
  refreshRuntimeAttachmentSources: async () => {},
  readSessionModelCatalog: async () => emptyCatalog,
  readSessionTodos: async () => [],
  clearComposerInput: () => {},
  ...overrides,
});

describe("useAgentStudioSelectionController", () => {
  beforeEach(async () => {
    mock.module("@/state/app-state-provider", () => ({
      AppStateProvider: ({ children }: { children: unknown }) => children,
      useActiveWorkspace: () => null,
      useAgentState: () => {
        throw new Error("useAgentState is not used in this test");
      },
      useAgentOperations: () => {
        throw new Error("useAgentOperations is not used in this test");
      },
      useAgentSessions: () => {
        throw new Error("useAgentSessions is not used in this test");
      },
      useAgentSessionSummaries: () => {
        throw new Error("useAgentSessionSummaries is not used in this test");
      },
      useAgentActivitySessions: () => {
        throw new Error("useAgentActivitySessions is not used in this test");
      },
      useWorkspaceState: () => {
        throw new Error("useWorkspaceState is not used in this test");
      },
      useTasksState: () => {
        throw new Error("useTasksState is not used in this test");
      },
      useChecksState: () => {
        throw new Error("useChecksState is not used in this test");
      },
      useSpecState: () => {
        throw new Error("useSpecState is not used in this test");
      },
      useAgentSession: (externalSessionId: string | null) =>
        externalSessionId ? (sessionByIdRef.current[externalSessionId] ?? null) : null,
    }));

    ({ buildSessionsByTaskIdWithCache, useAgentStudioSelectionController } = await import(
      "./use-agent-studio-selection-controller"
    ));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => import("../../state/app-state-provider")],
    ]);
  });

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
      [firstTaskOneOld, firstTaskOneNew, firstTaskTwo].map(toAgentSessionSummary),
      new Map(),
    );

    expect(
      first.sessionsByTaskId.get("task-1")?.map((session) => session.externalSessionId),
    ).toEqual(["session-new", "session-old"]);

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
      [secondTaskOneOld, secondTaskOneNew, secondTaskTwoNew].map(toAgentSessionSummary),
      first.nextCache,
    );

    expect(
      second.sessionsByTaskId.get("task-1")?.map((session) => session.externalSessionId),
    ).toEqual(["session-new", "session-old"]);
    expect(
      second.sessionsByTaskId.get("task-2")?.map((session) => session.externalSessionId),
    ).toEqual(["session-2-new"]);
  });

  test("keeps cache signature stable when task sessions arrive in a different order", () => {
    const sessionOld = createSession("task-1", "session-old", {
      startedAt: "2026-02-22T10:00:00.000Z",
    });
    const sessionNew = createSession("task-1", "session-new", {
      startedAt: "2026-02-22T11:00:00.000Z",
    });

    const first = buildSessionsByTaskIdWithCache(
      [sessionOld, sessionNew].map(toAgentSessionSummary),
      new Map(),
    );
    const second = buildSessionsByTaskIdWithCache(
      [sessionNew, sessionOld].map(toAgentSessionSummary),
      first.nextCache,
    );

    expect(second.nextCache.get("task-1")?.inputSignature).toBe(
      first.nextCache.get("task-1")?.inputSignature,
    );
    expect(
      second.sessionsByTaskId.get("task-1")?.map((session) => session.externalSessionId),
    ).toEqual(["session-new", "session-old"]);
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
      expect(latest.activeSession?.externalSessionId).toBe("session-2");
      expect(latest.viewTaskId).toBe("task-2");
      expect(latest.viewActiveSession?.externalSessionId).toBe("session-2");
    } finally {
      await harness.unmount();
    }
  });

  test("prefers optimistic selection intent over stale query role and session", async () => {
    const specSession = createSession("task-1", "session-spec", {
      role: "spec",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const plannerSession = createSession("task-1", "session-planner", {
      role: "planner",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });
    const harness = createHookHarness(
      createBaseArgs({
        sessions: [specSession, plannerSession],
        taskIdParam: "task-1",
        sessionParam: "session-spec",
        hasExplicitRoleParam: true,
        roleFromQuery: "spec",
        selectionIntent: {
          taskId: "task-1",
          externalSessionId: "session-planner",
          role: "planner",
        },
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.viewRole).toBe("planner");
      expect(latest.viewLaunchActionId).toBe("planner_initial");
      expect(latest.viewActiveSession?.externalSessionId).toBe("session-planner");
      expect(latest.activeSession?.externalSessionId).toBe("session-planner");
    } finally {
      await harness.unmount();
    }
  });

  test("suppresses stale query task and session selection while repo boundary reset is pending", async () => {
    const readSessionModelCatalog = mock(async () => emptyCatalog);
    const readSessionTodos = mock(async () => []);
    const hydrateRequestedTaskSessionHistory = mock(async () => {});
    const staleSession = createSession("task-1", "session-1", {
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      role: "build",
      status: "running",
    });
    const harness = createHookHarness(
      createBaseArgs({
        isRepoNavigationBoundaryPending: true,
        sessions: [staleSession],
        taskIdParam: "task-1",
        sessionParam: "session-1",
        hasExplicitRoleParam: true,
        roleFromQuery: "build",
        readSessionModelCatalog,
        readSessionTodos,
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();

      const latest = harness.getLatest();
      expect(latest.selectedSessionById).toBeNull();
      expect(latest.taskId).toBe("");
      expect(latest.selectedTask).toBeNull();
      expect(latest.activeSession).toBeNull();
      expect(latest.viewTaskId).toBe("");
      expect(latest.viewActiveSession).toBeNull();
      expect(readSessionModelCatalog).toHaveBeenCalledTimes(0);
      expect(readSessionTodos).toHaveBeenCalledTimes(0);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(0);
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
      expect(latest.viewLaunchActionId).toBe("build_implementation_start");
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
      startedAt: "2026-02-22T12:00:00.000Z",
      status: "running",
    });
    const sessionTaskTwo = createSession("task-2", "session-2", {
      role: "qa",
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
      expect(harness.getLatest().viewActiveSession?.externalSessionId).toBe("session-1");

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });

      const latest = harness.getLatest();
      expect(latest.viewTaskId).toBe("task-2");
      expect(latest.viewActiveSession?.externalSessionId).toBe("session-2");
      expect(latest.viewRole).toBe("qa");
      expect(latest.viewLaunchActionId).toBe("qa_review");
    } finally {
      await harness.unmount();
    }
  });

  test("tab shows working status when newer idle session exists but older session is running", async () => {
    const olderRunningSession = createSession("task-1", "session-old", {
      role: "build",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "running",
    });
    const newerIdleSession = createSession("task-1", "session-new", {
      role: "build",
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
      expect(latest.viewLaunchActionId).toBe("build_implementation_start");
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
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const newerQaSession = createSession("task-1", "session-qa", {
      role: "qa",
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

      expect(harness.getLatest().viewActiveSession?.externalSessionId).toBe("session-build");
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

      expect(harness.getLatest().viewActiveSession?.externalSessionId).toBe("session-build");
      expect(harness.getLatest().viewRole).toBe("build");
      expect(harness.getLatest().viewLaunchActionId).toBe("build_after_human_request_changes");
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
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const qaSession = createSession("task-1", "session-qa", {
      role: "qa",
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
      expect(harness.getLatest().viewActiveSession?.externalSessionId).toBe("session-build");
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

      expect(harness.getLatest().viewActiveSession?.externalSessionId).toBe("session-build");
      expect(harness.getLatest().viewRole).toBe("build");
      expect(harness.getLatest().viewLaunchActionId).toBe("build_after_human_request_changes");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps build selected after task-tab navigation settles on a human_review task", async () => {
    const updateQuery = mock(() => {});
    const taskOne = createTask("task-1");
    const humanReviewTask = createTaskCardFixture({
      id: "task-2",
      title: "task-2",
      status: "human_review",
    });
    const buildSession = createSession("task-2", "session-build", {
      role: "build",
      startedAt: "2026-02-22T10:00:00.000Z",
      status: "idle",
    });
    const qaSession = createSession("task-2", "session-qa", {
      role: "qa",
      startedAt: "2026-02-22T11:00:00.000Z",
      status: "idle",
    });

    const harness = createHookHarness(
      createBaseArgs({
        tasks: [taskOne, humanReviewTask],
        sessions: [buildSession, qaSession],
        taskIdParam: "task-1",
        sessionParam: null,
        hasExplicitRoleParam: false,
        roleFromQuery: "qa",
        updateQuery,
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.handleSelectTab("task-2");
      });

      expect(harness.getLatest().viewTaskId).toBe("task-2");
      expect(harness.getLatest().viewActiveSession?.externalSessionId).toBe("session-build");
      expect(harness.getLatest().viewRole).toBe("build");
      expect(updateQuery).toHaveBeenCalledWith({
        task: "task-2",
        session: undefined,
        agent: undefined,
        autostart: undefined,
        start: undefined,
      });

      await harness.update(
        createBaseArgs({
          tasks: [taskOne, humanReviewTask],
          sessions: [buildSession, qaSession],
          taskIdParam: "task-2",
          sessionParam: null,
          hasExplicitRoleParam: false,
          roleFromQuery: "qa",
          updateQuery,
        }),
      );

      expect(harness.getLatest().viewTaskId).toBe("task-2");
      expect(harness.getLatest().viewActiveSession?.externalSessionId).toBe("session-build");
      expect(harness.getLatest().viewRole).toBe("build");
      expect(harness.getLatest().viewLaunchActionId).toBe("build_after_human_request_changes");
    } finally {
      await harness.unmount();
    }
  });
});
