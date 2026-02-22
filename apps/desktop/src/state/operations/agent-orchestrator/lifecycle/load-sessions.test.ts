import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { createDeferred, createTaskCardFixture } from "../test-utils";
import { createLoadAgentSessions } from "./load-sessions";

type SessionHistory = Awaited<
  ReturnType<Parameters<typeof createLoadAgentSessions>[0]["adapter"]["loadSessionHistory"]>
>;

const taskFixture = createTaskCardFixture({ title: "Task" });

describe("agent-orchestrator-load-sessions", () => {
  test("no-ops when active repo is missing", async () => {
    let setCalled = false;
    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: null,
      adapter: {
        loadSessionHistory: async () => [],
      },
      repoEpochRef: { current: 0 },
      previousRepoRef: { current: null },
      sessionsRef: { current: {} },
      setSessionsById: () => {
        setCalled = true;
      },
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
    });

    await loadAgentSessions("task-1");

    expect(setCalled).toBe(false);
  });

  test("no-ops for blank task ids", async () => {
    let setCalled = false;
    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: {
        loadSessionHistory: async () => [],
      },
      repoEpochRef: { current: 0 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef: { current: {} },
      setSessionsById: () => {
        setCalled = true;
      },
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
    });

    await loadAgentSessions("   ");

    expect(setCalled).toBe(false);
  });

  test("hydrates persisted session records into state map", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: {
        loadSessionHistory: async () => [],
      },
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
    });

    const originalList = (await import("../../host")).host.agentSessionsList;
    (await import("../../host")).host.agentSessionsList = async () => [
      {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      },
    ];

    try {
      await loadAgentSessions("task-1");
    } finally {
      (await import("../../host")).host.agentSessionsList = originalList;
    }

    expect(Object.keys(state)).toContain("session-1");
    expect(state["session-1"]?.status).toBe("stopped");
  });

  test("skips hydration when repo epoch changes while loading persisted sessions", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    const repoEpochRef = { current: 2 };
    const previousRepoRef = { current: "/tmp/repo" as string | null };
    const listDeferred = createDeferred<AgentSessionRecord[]>();
    let setCalls = 0;
    let state: Record<string, AgentSessionState> = {};
    let updateCalls = 0;
    let todosLoads = 0;
    let modelCatalogLoads = 0;
    let historyLoads = 0;

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      setCalls += 1;
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: {
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
      },
      repoEpochRef,
      previousRepoRef,
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: () => {
        updateCalls += 1;
      },
      loadSessionTodos: async () => {
        todosLoads += 1;
      },
      loadSessionModelCatalog: async () => {
        modelCatalogLoads += 1;
      },
    });

    const originalList = (await import("../../host")).host.agentSessionsList;
    (await import("../../host")).host.agentSessionsList = async () => listDeferred.promise;

    try {
      const loadPromise = loadAgentSessions("task-1");
      repoEpochRef.current = 3;
      previousRepoRef.current = "/tmp/other-repo";

      listDeferred.resolve([
        {
          sessionId: "session-stale",
          externalSessionId: "external-stale",
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: "runtime-1",
          runId: "run-1",
          baseUrl: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo",
        },
      ]);
      await loadPromise;
    } finally {
      (await import("../../host")).host.agentSessionsList = originalList;
    }

    expect(setCalls).toBe(0);
    expect(Object.keys(state)).toHaveLength(0);
    expect(updateCalls).toBe(0);
    expect(historyLoads).toBe(0);
    expect(todosLoads).toBe(0);
    expect(modelCatalogLoads).toBe(0);
  });

  test("starts history loading while prelude documents are still loading", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const specDeferred = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const historyDeferred = createDeferred<SessionHistory>();
    let historyStarted = 0;

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      const next = updater(current);
      state = {
        ...state,
        [sessionId]: next,
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: {
        loadSessionHistory: async () => {
          historyStarted += 1;
          return historyDeferred.promise;
        },
      },
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
    });

    const hostModule = await import("../../host");
    const originalList = hostModule.host.agentSessionsList;
    const originalSpecGet = hostModule.host.specGet;
    const originalPlanGet = hostModule.host.planGet;
    const originalQaGetReport = hostModule.host.qaGetReport;

    hostModule.host.agentSessionsList = async () => [
      {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      },
    ];
    hostModule.host.specGet = async () => specDeferred.promise;
    hostModule.host.planGet = async () => ({ markdown: "plan", updatedAt: null });
    hostModule.host.qaGetReport = async () => ({ markdown: "qa", updatedAt: null });

    try {
      const loadPromise = loadAgentSessions("task-1");
      await Promise.resolve();

      expect(historyStarted).toBe(1);

      specDeferred.resolve({ markdown: "spec", updatedAt: null });
      historyDeferred.resolve([]);
      await loadPromise;
    } finally {
      specDeferred.resolve({ markdown: "spec", updatedAt: null });
      historyDeferred.resolve([]);
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.specGet = originalSpecGet;
      hostModule.host.planGet = originalPlanGet;
      hostModule.host.qaGetReport = originalQaGetReport;
    }

    expect(state["session-1"]?.messages.length).toBeGreaterThan(0);
  });
});
