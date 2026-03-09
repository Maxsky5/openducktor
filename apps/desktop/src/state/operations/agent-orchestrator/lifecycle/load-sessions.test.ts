import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createDeferred, createTaskCardFixture } from "../test-utils";
import { createLoadAgentSessions } from "./load-sessions";

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
      loadRepoPromptOverrides: async () => ({}),
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
      loadRepoPromptOverrides: async () => ({}),
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
      loadRepoPromptOverrides: async () => ({}),
    });

    const originalList = (await import("../../host")).host.agentSessionsList;
    (await import("../../host")).host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
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

  test("does not eagerly hydrate session history without an explicit target session", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let historyLoads = 0;
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
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
      },
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../host");
    const originalList = hostModule.host.agentSessionsList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      },
    ];

    try {
      await loadAgentSessions("task-1");
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(Object.keys(state)).toContain("session-1");
    expect(historyLoads).toBe(0);
    expect(state["session-1"]?.messages).toEqual([]);
  });

  test("hydrates requested session through its persisted runtime kind when endpoint is missing", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let observedRuntimeEndpoint = "";
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
        loadSessionHistory: async ({ runtimeConnection }) => {
          observedRuntimeEndpoint = runtimeConnection.endpoint ?? "";
          return [];
        },
      },
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    const ensuredRuntimeKinds: string[] = [];
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "claude-code",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
        selectedModel: {
          runtimeKind: "claude-code",
          providerId: "anthropic",
          modelId: "claude-3-7-sonnet",
        },
      },
    ];
    hostModule.host.runtimeList = async (runtimeKind) => [
      {
        kind: runtimeKind,
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: "task-1",
        role: "planner",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: {
          ...OPENCODE_RUNTIME_DESCRIPTOR,
          kind: runtimeKind,
          label: "Claude Code",
          description: "Claude Code runtime",
        },
      },
    ];
    hostModule.host.runtimeEnsure = async (runtimeKind, _repoPath) => {
      ensuredRuntimeKinds.push(runtimeKind);
      return {
        kind: runtimeKind,
        runtimeId: "runtime-claude",
        repoPath: "/tmp/repo",
        taskId: "repo-main",
        role: "spec",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: {
          ...OPENCODE_RUNTIME_DESCRIPTOR,
          kind: runtimeKind,
          label: "Claude Code",
          description: "Claude Code runtime",
        },
      };
    };

    try {
      await loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-1" });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(observedRuntimeEndpoint).toBe("http://127.0.0.1:4555");
    expect(state["session-1"]?.runtimeKind).toBe("claude-code");
  });

  test("rehydrates persisted sessions that exist in memory with empty message history", async () => {
    const existingSession: AgentSessionState = {
      runtimeKind: "opencode",
      sessionId: "session-1",
      externalSessionId: "external-1",
      taskId: "task-1",
      role: "build",
      scenario: "build_implementation_start",
      status: "stopped",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeId: "runtime-1",
      runId: "run-1",
      runtimeEndpoint: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo",
      messages: [],
      draftAssistantText: "",
      pendingPermissions: [],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: null,
      isLoadingModelCatalog: true,
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "session-1": existingSession },
    };
    let state: Record<string, AgentSessionState> = sessionsRef.current;
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

    let historyLoads = 0;
    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: {
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
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
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRunsList = hostModule.host.runsList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      },
    ];
    hostModule.host.runsList = async () => [
      {
        runId: "run-1",
        runtimeKind: "opencode",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4444",
        },
        repoPath: "/tmp/repo",
        taskId: "task-1",
        branch: "obp/task-1",
        worktreePath: "/tmp/repo/worktree",
        port: 4444,
        state: "running",
        lastMessage: null,
        startedAt: "2026-02-22T08:00:00.000Z",
      },
    ];

    try {
      await loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-1" });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runsList = originalRunsList;
    }

    expect(historyLoads).toBe(1);
    expect(state["session-1"]?.messages.length).toBeGreaterThan(0);
    expect(state["session-1"]?.messages[0]?.id).toBe("history:session-start:session-1");
  });

  test("rehydrates build sessions through a shared runtime when the persisted working directory is an override", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let observedRuntimeEndpoint: string | null = null;
    const ensuredRuntimeKinds: string[] = [];

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
      observedRuntimeEndpoint = next.runtimeEndpoint;
      state = {
        ...state,
        [sessionId]: next,
      };
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
      updateSession,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = hostModule.host.runsList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/conflict-worktree",
      },
    ];
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-shared",
        repoPath: "/tmp/repo",
        taskId: "repo-main",
        role: "planner",
        workingDirectory: "/tmp/repo/shared",
        runtimeRoute: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4666",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];
    hostModule.host.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (runtimeKind) => {
      ensuredRuntimeKinds.push(runtimeKind);
      return {
        kind: runtimeKind,
        runtimeId: "runtime-shared",
        repoPath: "/tmp/repo",
        taskId: "repo-main",
        role: "planner",
        workingDirectory: "/tmp/repo/shared",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4666",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      };
    };

    try {
      await loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-1" });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual(["opencode"]);
    if (observedRuntimeEndpoint === null) {
      throw new Error("Expected shared runtime hydration to set a runtime endpoint");
    }
    if (observedRuntimeEndpoint !== "http://127.0.0.1:4666") {
      throw new Error(`Unexpected shared runtime endpoint: ${observedRuntimeEndpoint}`);
    }
    expect(state["session-1"]?.workingDirectory).toBe("/tmp/repo/conflict-worktree");
    expect(state["session-1"]?.messages[0]?.id).toBe("history:session-start:session-1");
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
      loadRepoPromptOverrides: async () => ({}),
    });

    const originalList = (await import("../../host")).host.agentSessionsList;
    (await import("../../host")).host.agentSessionsList = async () => listDeferred.promise;

    try {
      const loadPromise = loadAgentSessions("task-1");
      repoEpochRef.current = 3;
      previousRepoRef.current = "/tmp/other-repo";

      listDeferred.resolve([
        {
          runtimeKind: "opencode",
          sessionId: "session-stale",
          externalSessionId: "external-stale",
          taskId: "task-1",
          role: "build",
          scenario: "build_implementation_start",
          status: "running",
          startedAt: "2026-02-22T08:00:00.000Z",
          updatedAt: "2026-02-22T08:00:00.000Z",
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

  test("rehydrates system prompt without eager document host calls", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let specCalls = 0;
    let planCalls = 0;
    let qaCalls = 0;

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
        loadSessionHistory: async () => [],
      },
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../host");
    const originalList = hostModule.host.agentSessionsList;
    const originalSpecGet = hostModule.host.specGet;
    const originalPlanGet = hostModule.host.planGet;
    const originalQaGetReport = hostModule.host.qaGetReport;

    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      },
    ];
    hostModule.host.specGet = async () => {
      specCalls += 1;
      return { markdown: "spec", updatedAt: null };
    };
    hostModule.host.planGet = async () => {
      planCalls += 1;
      return { markdown: "plan", updatedAt: null };
    };
    hostModule.host.qaGetReport = async () => {
      qaCalls += 1;
      return { markdown: "qa", updatedAt: null };
    };

    try {
      await loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-1" });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.specGet = originalSpecGet;
      hostModule.host.planGet = originalPlanGet;
      hostModule.host.qaGetReport = originalQaGetReport;
    }

    const messages = state["session-1"]?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("history-unavailable:session-1");
    expect(messages[0]?.content).toContain("Session runtime unavailable");
    expect(specCalls).toBe(0);
    expect(planCalls).toBe(0);
    expect(qaCalls).toBe(0);
  });
});
