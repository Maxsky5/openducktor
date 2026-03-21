import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { appQueryClient, clearAppQueryClient } from "@/lib/query-client";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createDeferred, createTaskCardFixture } from "../test-utils";
import { createLoadAgentSessions } from "./load-sessions";

const taskFixture = createTaskCardFixture({ title: "Task" });

const createAdapter = (
  overrides: Partial<Parameters<typeof createLoadAgentSessions>[0]["adapter"]> = {},
): Parameters<typeof createLoadAgentSessions>[0]["adapter"] => ({
  hasSession: () => false,
  listRuntimeSessions: async () => [],
  loadSessionHistory: async () => [],
  resumeSession: async (input) => ({
    sessionId: input.sessionId,
    externalSessionId: input.externalSessionId,
    role: input.role,
    scenario: input.scenario,
    startedAt: "2026-02-22T08:00:00.000Z",
    status: "idle",
    runtimeKind: input.runtimeKind,
  }),
  ...overrides,
});

describe("agent-orchestrator-load-sessions", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
    const hostModule = await import("../../shared/host");
    hostModule.host.runtimeList = async () => [];
    hostModule.host.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (repoPath) => ({
      kind: "opencode",
      runtimeId: "runtime-1",
      repoPath,
      taskId: null,
      role: "workspace",
      workingDirectory: repoPath,
      runtimeRoute: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4444",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    });
  });

  test("no-ops when active repo is missing", async () => {
    let setCalled = false;
    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: null,
      adapter: createAdapter(),
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
      adapter: createAdapter(),
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
      adapter: createAdapter(),
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

    const originalList = (await import("../../shared/host")).host.agentSessionsList;
    (await import("../../shared/host")).host.agentSessionsList = async () => [
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
        pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: ["**/*"] }],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Question",
                question: "Need answer",
                options: [],
                custom: true,
              },
            ],
          },
        ],
      },
    ];

    try {
      await loadAgentSessions("task-1");
    } finally {
      (await import("../../shared/host")).host.agentSessionsList = originalList;
    }

    expect(Object.keys(state)).toContain("session-1");
    expect(state["session-1"]?.status).toBe("stopped");
    expect(state["session-1"]?.pendingPermissions).toEqual([
      { requestId: "permission-1", permission: "read", patterns: ["**/*"] },
    ]);
    expect(state["session-1"]?.pendingQuestions).toEqual([
      {
        requestId: "question-1",
        questions: [
          {
            header: "Question",
            question: "Need answer",
            options: [],
            custom: true,
          },
        ],
      },
    ]);
  });

  test("merges persisted pending input into an existing session entry", async () => {
    const existingSession: AgentSessionState = {
      sessionId: "session-1",
      externalSessionId: "external-1",
      taskId: "task-1",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeKind: "opencode",
      runtimeId: null,
      runId: null,
      runtimeEndpoint: "",
      workingDirectory: "/tmp/repo",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:01.000Z",
          content: "Existing history",
          meta: { kind: "assistant", agentRole: "build", isFinal: true },
        },
      ],
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      contextUsage: null,
      pendingPermissions: [],
      pendingQuestions: [],
      todos: [],
      modelCatalog: null,
      selectedModel: null,
      isLoadingModelCatalog: false,
      promptOverrides: {},
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

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter(),
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

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:02.000Z",
        workingDirectory: "/tmp/repo",
        pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: ["**/*"] }],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Question",
                question: "Need answer",
                options: [],
                custom: true,
              },
            ],
          },
        ],
      },
    ];

    try {
      await loadAgentSessions("task-1");
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }

    expect(state["session-1"]?.messages).toEqual(existingSession.messages);
    expect(state["session-1"]?.pendingPermissions).toEqual([
      { requestId: "permission-1", permission: "read", patterns: ["**/*"] },
    ]);
    expect(state["session-1"]?.pendingQuestions).toEqual([
      {
        requestId: "question-1",
        questions: [
          {
            header: "Question",
            question: "Need answer",
            options: [],
            custom: true,
          },
        ],
      },
    ]);
  });

  test("does not eagerly hydrate session history or runtime connections without an explicit target session", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let historyLoads = 0;
    let runLoads = 0;
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
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
      }),
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

    const hostModule = await import("../../shared/host");
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
        workingDirectory: "/tmp/repo",
      },
    ];
    hostModule.host.runsList = async () => {
      runLoads += 1;
      return [];
    };

    try {
      await loadAgentSessions("task-1");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runsList = originalRunsList;
    }

    expect(Object.keys(state)).toContain("session-1");
    expect(historyLoads).toBe(0);
    expect(runLoads).toBe(0);
    expect(state["session-1"]?.messages).toEqual([]);
    expect(state["session-1"]?.runtimeEndpoint).toBe("");
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
      adapter: createAdapter({
        loadSessionHistory: async ({ runtimeConnection }) => {
          observedRuntimeEndpoint = runtimeConnection.endpoint ?? "";
          return [];
        },
      }),
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

    const hostModule = await import("../../shared/host");
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
    hostModule.host.runtimeList = async (_repoPath, runtimeKind = "opencode") => [
      {
        kind: runtimeKind,
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
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
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => {
      ensuredRuntimeKinds.push(runtimeKind);
      return {
        kind: runtimeKind,
        runtimeId: "runtime-claude",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
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

  test("rejects requested-session warmup when persisted runtime metadata is missing", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": {
          runtimeKind: "opencode",
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          role: "planner",
          scenario: "planner_initial",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: "runtime-1",
          runId: null,
          runtimeEndpoint: "http://127.0.0.1:4555",
          workingDirectory: "/tmp/repo",
          messages: [
            {
              id: "history:session-start:session-1",
              role: "system",
              content: "Session started (planner - planner_initial)",
              timestamp: "2026-02-22T08:00:00.000Z",
            },
          ],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          pendingPermissions: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: null,
          selectedModel: null,
          isLoadingModelCatalog: false,
        },
      },
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter(),
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById: () => {},
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    hostModule.host.agentSessionsList = async () => [
      {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      } as AgentSessionRecord,
    ];

    try {
      await expect(
        loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-1" }),
      ).rejects.toThrow("Persisted session 'session-1' is missing runtime kind metadata.");
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }
  });

  test("warms requested-session todos even when the model catalog is already loaded", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": {
          runtimeKind: "opencode",
          sessionId: "session-1",
          externalSessionId: "external-1",
          taskId: "task-1",
          role: "planner",
          scenario: "planner_initial",
          status: "idle",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeId: "runtime-1",
          runId: null,
          runtimeEndpoint: "http://127.0.0.1:4555",
          workingDirectory: "/tmp/repo",
          messages: [
            {
              id: "history:session-start:session-1",
              role: "system",
              content: "Session started (planner - planner_initial)",
              timestamp: "2026-02-22T08:00:00.000Z",
            },
          ],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          pendingPermissions: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: {
            models: [],
            defaultModelsByProvider: {},
          },
          selectedModel: null,
          isLoadingModelCatalog: false,
        },
      },
    };
    let todoLoads = 0;
    let modelCatalogLoads = 0;

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter(),
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById: () => {},
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      loadSessionTodos: async () => {
        todoLoads += 1;
      },
      loadSessionModelCatalog: async () => {
        modelCatalogLoads += 1;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      },
    ];
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      await loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-1" });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }

    expect(todoLoads).toBe(1);
    expect(modelCatalogLoads).toBe(0);
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
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
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
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
      }),
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

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
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
    hostModule.host.runtimeList = async () => [];
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
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runsList = originalRunsList;
    }

    expect(historyLoads).toBe(1);
    expect(state["session-1"]?.messages.length).toBeGreaterThan(0);
    expect(state["session-1"]?.messages[0]?.id).toBe("history:session-start:session-1");
  });

  test("rejects hydration when a persisted session record is missing runtime metadata", async () => {
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
      adapter: createAdapter(),
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

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
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
        workingDirectory: "/tmp/repo/worktree",
      } as AgentSessionRecord,
    ];

    try {
      await expect(
        loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-1" }),
      ).rejects.toThrow("Persisted session 'session-1' is missing runtime kind metadata.");
      expect(state["session-1"]?.messages ?? []).toEqual([]);
    } finally {
      hostModule.host.agentSessionsList = originalList;
    }
  });

  test("rehydrates qa sessions through an active build run when no persisted build session exists", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let observedRuntimeEndpoint: string | null = null;

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
      adapter: createAdapter(),
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

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = hostModule.host.runsList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-qa-1",
        externalSessionId: "external-qa-1",
        taskId: "task-1",
        role: "qa",
        scenario: "qa_review",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      },
    ];
    hostModule.host.runtimeList = async () => [];
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
      await loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-qa-1" });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runsList = originalRunsList;
    }

    if (observedRuntimeEndpoint === null) {
      throw new Error("Expected QA hydration to resolve a live runtime endpoint");
    }
    expect(String(observedRuntimeEndpoint)).toBe("http://127.0.0.1:4444");
    expect(state["session-qa-1"]?.messages[0]?.id).toBe("history:session-start:session-qa-1");
  });

  test("does not ensure a workspace runtime for qa sessions when repo root paths only differ by trailing slash", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
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
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter(),
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

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = hostModule.host.runsList;
    const originalEnsure = hostModule.host.runtimeEnsure;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-qa-root",
        externalSessionId: "external-qa-root",
        taskId: "task-1",
        role: "qa",
        scenario: "qa_review",
        status: "stopped",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/",
      },
    ];
    hostModule.host.runtimeList = async () => [];
    hostModule.host.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => {
      ensuredRuntimeKinds.push(runtimeKind);
      return {
        kind: runtimeKind,
        runtimeId: "runtime-root",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: {
          ...OPENCODE_RUNTIME_DESCRIPTOR,
          kind: runtimeKind,
          label: "OpenCode",
          description: "Shared runtime",
        },
      };
    };

    try {
      await expect(
        loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-qa-root" }),
      ).rejects.toThrow("No live runtime found for working directory /tmp/repo/.");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(ensuredRuntimeKinds).toEqual([]);
    expect(state["session-qa-root"]?.messages).toEqual([]);
  });

  test("invalidates runtime list cache after ensuring a workspace runtime during hydration", async () => {
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

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[sessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter(),
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

    const queryKey = runtimeQueryKeys.list("opencode", "/tmp/repo");
    appQueryClient.setQueryData(queryKey, []);

    const hostModule = await import("../../shared/host");
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
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      },
    ];
    hostModule.host.runtimeList = async () => [];
    hostModule.host.runsList = async () => [];
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => ({
      kind: runtimeKind,
      runtimeId: "runtime-shared",
      repoPath: "/tmp/repo",
      taskId: null,
      role: "workspace",
      workingDirectory: "/tmp/repo",
      runtimeRoute: {
        type: "local_http" as const,
        endpoint: "http://127.0.0.1:4666",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    });

    try {
      await loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-1" });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
    }

    expect(appQueryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
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
      adapter: createAdapter(),
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

    const hostModule = await import("../../shared/host");
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
        taskId: null,
        role: "workspace",
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
    hostModule.host.runtimeEnsure = async (_repoPath, runtimeKind) => {
      ensuredRuntimeKinds.push(runtimeKind);
      return {
        kind: runtimeKind,
        runtimeId: "runtime-shared",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
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

  test("resumes live persisted sessions when runtime discovery finds them active", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let resumeCalls = 0;
    let attachedListeners = 0;

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
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter({
        listRuntimeSessions: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
          },
        ],
        resumeSession: async (input) => {
          resumeCalls += 1;
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        status: "running",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      },
    ];
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      await loadAgentSessions("task-1", { reconcileLiveSessions: true });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }

    expect(resumeCalls).toBe(1);
    expect(attachedListeners).toBe(1);
    expect(state["session-1"]?.status).toBe("running");
    expect(state["session-1"]?.runtimeEndpoint).toBe("http://127.0.0.1:4555");
  });

  test("does not attach resumed sessions when the repo changes while resume is in flight", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const repoEpochRef = { current: 2 };
    const previousRepoRef = { current: "/tmp/repo" as string | null };
    const resumeDeferred = createDeferred<void>();
    let attachedListeners = 0;

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
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter({
        listRuntimeSessions: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
          },
        ],
        resumeSession: async (input) => {
          await resumeDeferred.promise;
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef,
      previousRepoRef,
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      },
    ];
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      const loadPromise = loadAgentSessions("task-1", { reconcileLiveSessions: true });
      repoEpochRef.current = 3;
      previousRepoRef.current = "/tmp/other-repo";
      resumeDeferred.resolve(undefined);
      await loadPromise;
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }

    expect(attachedListeners).toBe(0);
    expect(state["session-1"]).toBeUndefined();
  });

  test("does not resume persisted sessions when the runtime does not report them live", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let resumeCalls = 0;

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
      adapter: createAdapter({
        listRuntimeSessions: async () => [],
        resumeSession: async (input) => {
          resumeCalls += 1;
          return {
            sessionId: input.sessionId,
            externalSessionId: input.externalSessionId,
            role: input.role,
            scenario: input.scenario,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: () => {},
      attachSessionListener: () => {},
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      },
    ];
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      await loadAgentSessions("task-1", { reconcileLiveSessions: true });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }

    expect(resumeCalls).toBe(0);
    expect(state["session-1"]?.status).toBe("stopped");
  });

  test("reattaches already attached live sessions when reconciling after a repo switch", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedListeners = 0;

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
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter({
        hasSession: () => true,
        listRuntimeSessions: async () => [
          {
            externalSessionId: "external-1",
            title: "PLANNER task-1",
            workingDirectory: "/tmp/repo",
            startedAt: "2026-02-22T08:00:00.000Z",
            status: { type: "busy" },
          },
        ],
      }),
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      },
    ];
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      await loadAgentSessions("task-1", { reconcileLiveSessions: true });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }

    expect(attachedListeners).toBe(1);
    expect(state["session-1"]?.status).toBe("running");
    expect(state["session-1"]?.runtimeEndpoint).toBe("http://127.0.0.1:4555");
  });

  test("does not reattach adapter-held sessions when the runtime no longer reports them live", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedListeners = 0;

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
      state = {
        ...state,
        [sessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      activeRepo: "/tmp/repo",
      adapter: createAdapter({
        hasSession: () => true,
        listRuntimeSessions: async () => [],
      }),
      repoEpochRef: { current: 2 },
      previousRepoRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadRepoPromptOverrides: async () => ({}),
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    hostModule.host.agentSessionsList = async () => [
      {
        runtimeKind: "opencode",
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
      },
    ];
    hostModule.host.runtimeList = async () => [
      {
        kind: "opencode",
        runtimeId: "runtime-1",
        repoPath: "/tmp/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/tmp/repo/worktree",
        runtimeRoute: {
          type: "local_http" as const,
          endpoint: "http://127.0.0.1:4555",
        },
        startedAt: "2026-02-22T08:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      },
    ];

    try {
      await loadAgentSessions("task-1", { reconcileLiveSessions: true });
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
    }

    expect(attachedListeners).toBe(0);
    expect(state["session-1"]?.status).toBe("stopped");
    expect(state["session-1"]?.runtimeEndpoint).toBe("http://127.0.0.1:4555");
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
      adapter: createAdapter({
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [];
        },
      }),
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

    const originalList = (await import("../../shared/host")).host.agentSessionsList;
    (await import("../../shared/host")).host.agentSessionsList = async () => listDeferred.promise;

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
      (await import("../../shared/host")).host.agentSessionsList = originalList;
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
      adapter: createAdapter(),
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

    const hostModule = await import("../../shared/host");
    const originalList = hostModule.host.agentSessionsList;
    const originalRuntimeList = hostModule.host.runtimeList;
    const originalRunsList = hostModule.host.runsList;
    const originalEnsure = hostModule.host.runtimeEnsure;
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
    hostModule.host.runtimeList = async () => [];
    hostModule.host.runsList = async () => [];
    hostModule.host.runtimeEnsure = async () => {
      throw new Error("runtime unavailable");
    };
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
      await expect(
        loadAgentSessions("task-1", { hydrateHistoryForSessionId: "session-1" }),
      ).rejects.toThrow("runtime unavailable");
    } finally {
      hostModule.host.agentSessionsList = originalList;
      hostModule.host.runtimeList = originalRuntimeList;
      hostModule.host.runsList = originalRunsList;
      hostModule.host.runtimeEnsure = originalEnsure;
      hostModule.host.specGet = originalSpecGet;
      hostModule.host.planGet = originalPlanGet;
      hostModule.host.qaGetReport = originalQaGetReport;
    }

    expect(state["session-1"]?.messages).toEqual([]);
    expect(specCalls).toBe(0);
    expect(planCalls).toBe(0);
    expect(qaCalls).toBe(0);
  });
});
