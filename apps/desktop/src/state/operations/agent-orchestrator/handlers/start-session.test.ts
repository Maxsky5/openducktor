import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { TaskCard } from "@openducktor/contracts";
import { host } from "../../host";
import { createStartAgentSession } from "./start-session";

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Implement feature",
  description: "desc",
  acceptanceCriteria: "ac",
  notes: "",
  status: "in_progress",
  priority: 1,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

describe("agent-orchestrator/handlers/start-session", () => {
  test("throws when no active repo is selected", () => {
    const start = createStartAgentSession({
      activeRepo: null,
      adapter: new OpencodeSdkAdapter(),
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [] },
      repoEpochRef: { current: 0 },
      previousRepoRef: { current: null },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: "runtime-2",
        runId: null,
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    expect(start({ taskId: "task-1", role: "build" })).rejects.toThrow("Select a workspace first.");
  });

  test("reuses an existing in-flight start promise", () => {
    const inFlight = Promise.resolve("session-in-flight");
    const inFlightMap = new Map<string, Promise<string>>([["/tmp/repo::task-1", inFlight]]);
    const start = createStartAgentSession({
      activeRepo: "/tmp/repo",
      adapter: new OpencodeSdkAdapter(),
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: inFlightMap },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: "runtime-1",
        runId: null,
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    expect(start({ taskId: "task-1", role: "build" })).resolves.toBe("session-in-flight");
  });

  test("reuses most recent in-memory session for same task", () => {
    let persistedListCalls = 0;
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const start = createStartAgentSession({
      activeRepo: "/tmp/repo",
      adapter: new OpencodeSdkAdapter(),
      setSessionsById: () => {},
      sessionsRef: {
        current: {
          newer: {
            sessionId: "newer",
            externalSessionId: "external-newer",
            taskId: "task-1",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
            runId: "run-2",
            baseUrl: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
            messages: [],
            draftAssistantText: "",
            pendingPermissions: [],
            pendingQuestions: [],
            todos: [],
            modelCatalog: null,
            selectedModel: null,
            isLoadingModelCatalog: false,
          },
        },
      },
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: "runtime-2",
        runId: null,
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      expect(start({ taskId: "task-1", role: "build" })).resolves.toBe("newer");
      expect(persistedListCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("returns latest persisted session and hydrates when missing from memory", async () => {
    let loadAgentSessionsCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [
      {
        sessionId: "persisted-2",
        externalSessionId: "external-2",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:20:00.000Z",
        updatedAt: "2026-02-22T08:20:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-2",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      },
      {
        sessionId: "persisted-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        updatedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      },
    ];

    const start = createStartAgentSession({
      activeRepo: "/tmp/repo",
      adapter: new OpencodeSdkAdapter(),
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: null,
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
      },
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      expect(start({ taskId: "task-1", role: "build" })).resolves.toBe("persisted-2");
      expect(loadAgentSessionsCalls).toBe(1);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("throws when task is missing after reuse checks", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    let startCalls = 0;
    adapter.startSession = async (input) => {
      startCalls += 1;
      return originalStartSession(input);
    };

    const start = createStartAgentSession({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: null,
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(start({ taskId: "task-1", role: "build" })).rejects.toThrow(
        "Task not found: task-1",
      );
      expect(startCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
      adapter.startSession = originalStartSession;
    }
  });

  test("fails fast on stale repo before any side effects", async () => {
    let persistedListCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const start = createStartAgentSession({
      activeRepo: "/tmp/repo",
      adapter: new OpencodeSdkAdapter(),
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/other" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: null,
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(start({ taskId: "task-1", role: "build" })).rejects.toThrow(
        "Workspace changed while starting session.",
      );
      expect(persistedListCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("rolls back started remote session when workspace becomes stale after start", async () => {
    const previousRepoRef = { current: "/tmp/repo" as string | null };
    let stopCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    const originalStopSession = adapter.stopSession;
    adapter.startSession = async () => {
      previousRepoRef.current = "/tmp/other";
      return {
        sessionId: "session-created",
        externalSessionId: "external-created",
        startedAt: "2026-02-22T08:00:10.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSession({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef,
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(start({ taskId: "task-1", role: "build" })).rejects.toThrow(
        "Workspace changed while starting session.",
      );
      expect(stopCalls).toBe(1);
    } finally {
      adapter.startSession = originalStartSession;
      adapter.stopSession = originalStopSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("creates a fresh session and triggers kickoff flow", async () => {
    let attachCalls = 0;
    let persistCalls = 0;
    let todosCalls = 0;
    let modelCatalogCalls = 0;
    let kickoffCalls = 0;
    let refreshCalls = 0;
    let startCalls = 0;

    let sessionsState: Record<string, AgentSessionState> = {};
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      sessionsState = typeof updater === "function" ? updater(sessionsState) : updater;
    };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => {
      startCalls += 1;
      return {
        sessionId: "session-created",
        externalSessionId: "external-created",
        startedAt: "2026-02-22T08:00:10.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const sessionsRef = { current: {} as Record<string, never> };
    const start = createStartAgentSession({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById,
      sessionsRef,
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {
        attachCalls += 1;
      },
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadSessionTodos: async () => {
        todosCalls += 1;
      },
      loadSessionModelCatalog: async () => {
        modelCatalogCalls += 1;
      },
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {
        refreshCalls += 1;
      },
      persistSessionSnapshot: async () => {
        persistCalls += 1;
      },
      sendAgentMessage: async () => {
        kickoffCalls += 1;
      },
    });

    try {
      const sessionId = await start({ taskId: "task-1", role: "build", sendKickoff: true });
      expect(sessionId).toBe("session-created");
      expect(startCalls).toBe(1);
      expect(attachCalls).toBe(1);
      expect(persistCalls).toBe(1);
      expect(todosCalls).toBe(1);
      expect(modelCatalogCalls).toBe(1);
      expect(kickoffCalls).toBe(1);
      expect(refreshCalls).toBe(1);
      expect(Object.keys(sessionsState)).toContain("session-created");
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });
});
