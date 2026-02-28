import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentModelSelection } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../host";
import { createDeferred, createTaskCardFixture, withTimeout } from "../test-utils";
import { createStartAgentSession } from "./start-session";
import {
  type FlatStartSessionDependencies,
  toStartSessionDependencies,
} from "./start-session.test-helpers";

const createStartAgentSessionWithFlatDeps = (deps: FlatStartSessionDependencies) => {
  return createStartAgentSession(toStartSessionDependencies(deps));
};

const taskFixture = createTaskCardFixture({
  title: "Implement feature",
  description: "desc",
  acceptanceCriteria: "ac",
  status: "in_progress",
  priority: 1,
});

describe("agent-orchestrator/handlers/start-session", () => {
  test("throws when no active repo is selected", () => {
    const start = createStartAgentSessionWithFlatDeps({
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

  test("reuses an existing in-flight start promise", async () => {
    const inFlight = Promise.resolve("session-in-flight");
    const inFlightMap = new Map<string, Promise<string>>([
      ["/tmp/repo::task-1::build::reuse_latest", inFlight],
    ]);
    const start = createStartAgentSessionWithFlatDeps({
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

    await expect(start({ taskId: "task-1", role: "build" })).resolves.toBe("session-in-flight");
  });

  test("does not dedupe in-flight starts across different roles", async () => {
    const startBuildDeferred = createDeferred<void>();
    const startedRoles: string[] = [];
    const buildStarted = createDeferred<void>();
    const plannerStarted = createDeferred<void>();

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startedRoles.push(input.role);
      if (input.role === "build") {
        buildStarted.resolve();
        await startBuildDeferred.promise;
      } else {
        plannerStarted.resolve();
      }
      return {
        sessionId: `${input.role}-session`,
        externalSessionId: `${input.role}-external`,
        startedAt: "2026-02-22T08:00:10.000Z",
        role: input.role,
        scenario: input.role === "planner" ? "planner_initial" : "build_implementation_start",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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

    try {
      const buildPromise = start({ taskId: "task-1", role: "build" });
      await Promise.resolve();
      const plannerPromise = start({ taskId: "task-1", role: "planner" });
      await buildStarted.promise;
      const plannerStartResult = await withTimeout(plannerStarted.promise, 50);

      expect(startedRoles).toEqual(["build", "planner"]);
      expect(plannerStartResult).toBeUndefined();

      startBuildDeferred.resolve();
      await expect(buildPromise).resolves.toBe("build-session");
      await expect(plannerPromise).resolves.toBe("planner-session");
    } finally {
      startBuildDeferred.resolve();
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses most recent in-memory session for same task and role", async () => {
    let persistedListCalls = 0;
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const start = createStartAgentSessionWithFlatDeps({
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
      await expect(start({ taskId: "task-1", role: "build" })).resolves.toBe("newer");
      expect(persistedListCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("startMode fresh bypasses same-role reuse and starts a new session", async () => {
    let startCalls = 0;
    let persistedListCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => {
      startCalls += 1;
      return {
        sessionId: "fresh-session",
        externalSessionId: "fresh-ext",
        startedAt: "2026-02-22T09:00:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [
        {
          sessionId: "persisted-build",
          externalSessionId: "persisted-build-ext",
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
      ];
    };

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: {
        current: {
          existingBuild: {
            sessionId: "existing-build",
            externalSessionId: "existing-build-ext",
            taskId: "task-1",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
            runId: "run-1",
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
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-2",
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
      await expect(start({ taskId: "task-1", role: "build", startMode: "fresh" })).resolves.toBe(
        "fresh-session",
      );
      expect(startCalls).toBe(1);
      expect(persistedListCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("does not reuse in-memory session from a different role", async () => {
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => {
      startCalls += 1;
      return {
        sessionId: "planner-created",
        externalSessionId: "planner-ext",
        startedAt: "2026-02-22T08:30:00.000Z",
        role: "planner",
        scenario: "planner_initial",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        existingSpec: {
          sessionId: "existing-spec",
          externalSessionId: "existing-spec-ext",
          taskId: "task-1",
          role: "spec",
          scenario: "spec_initial",
          status: "idle",
          startedAt: "2026-02-22T08:10:00.000Z",
          runtimeId: null,
          runId: "run-1",
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
    };

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-2",
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
      const sessionId = await start({ taskId: "task-1", role: "planner" });
      expect(sessionId).toBe("planner-created");
      expect(startCalls).toBe(1);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("returns latest persisted session for same role and hydrates when missing from memory", async () => {
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
      {
        sessionId: "persisted-spec-newer",
        externalSessionId: "external-spec-newer",
        taskId: "task-1",
        role: "spec",
        scenario: "spec_initial",
        status: "idle",
        startedAt: "2026-02-22T08:30:00.000Z",
        updatedAt: "2026-02-22T08:30:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-3",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      },
    ];

    const start = createStartAgentSessionWithFlatDeps({
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
      await expect(start({ taskId: "task-1", role: "build" })).resolves.toBe("persisted-2");
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

    const start = createStartAgentSessionWithFlatDeps({
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

  test("rejects start when selected role is unavailable for the task", async () => {
    let runtimeCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter: new OpencodeSdkAdapter(),
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            status: "open",
            agentWorkflows: {
              spec: { required: true, canSkip: false, available: true, completed: false },
              planner: { required: true, canSkip: false, available: false, completed: false },
              builder: { required: true, canSkip: false, available: false, completed: false },
              qa: { required: true, canSkip: false, available: false, completed: false },
            },
          }),
        ],
      },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          runtimeId: null,
          runId: null,
          baseUrl: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo",
        };
      },
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
        "Role 'build' is unavailable for task 'task-1' in status 'open'.",
      );
      expect(runtimeCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("fails fast on stale repo before any side effects", async () => {
    let persistedListCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const start = createStartAgentSessionWithFlatDeps({
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

  test("does not diverge ref/state when workspace becomes stale during initial session commit", async () => {
    const previousRepoRef = { current: "/tmp/repo" as string | null };
    let sessionsState: Record<string, AgentSessionState> = {};
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      previousRepoRef.current = "/tmp/other";
      sessionsState = typeof updater === "function" ? updater(sessionsState) : updater;
    };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => ({
      sessionId: "session-created",
      externalSessionId: "external-created",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
    });

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById,
      sessionsRef,
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
      expect(sessionsRef.current).toEqual({});
      expect(sessionsState).toEqual({});
    } finally {
      adapter.startSession = originalStartSession;
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

    const start = createStartAgentSessionWithFlatDeps({
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

  test("rolls back started remote session when workspace becomes stale after listener attach", async () => {
    const previousRepoRef = { current: "/tmp/repo" as string | null };
    let stopCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    const originalStopSession = adapter.stopSession;
    adapter.startSession = async () => {
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

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef,
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {
        previousRepoRef.current = "/tmp/other";
      },
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
    const start = createStartAgentSessionWithFlatDeps({
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

  test("starts runtime and default-model loading before documents resolve", async () => {
    const docsDeferred = createDeferred<{
      specMarkdown: string;
      planMarkdown: string;
      qaMarkdown: string;
    }>();
    let runtimeCalls = 0;
    let defaultModelCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => ({
      sessionId: "session-created",
      externalSessionId: "external-created",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
    });

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          runtimeId: null,
          runId: "run-1",
          baseUrl: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadTaskDocuments: async () => docsDeferred.promise,
      loadRepoDefaultModel: async () => {
        defaultModelCalls += 1;
        return null;
      },
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const startPromise = start({ taskId: "task-1", role: "build" });
      await Promise.resolve();

      expect(runtimeCalls).toBe(1);
      expect(defaultModelCalls).toBe(1);

      docsDeferred.resolve({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" });
      await expect(startPromise).resolves.toBe("session-created");
    } finally {
      docsDeferred.resolve({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" });
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("does not block start completion on kickoff refresh", async () => {
    const refreshDeferred = createDeferred<void>();
    let refreshCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => ({
      sessionId: "session-created",
      externalSessionId: "external-created",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
    });

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
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
      refreshTaskData: async () => {
        refreshCalls += 1;
        return refreshDeferred.promise;
      },
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const startPromise = start({ taskId: "task-1", role: "build", sendKickoff: true });
      const raceResult = await withTimeout(startPromise, 20);
      refreshDeferred.resolve();

      expect(raceResult).toBe("session-created");
      expect(refreshCalls).toBe(1);
      await expect(startPromise).resolves.toBe("session-created");
    } finally {
      refreshDeferred.resolve();
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("requireModelReady waits for and applies resolved default model before completion", async () => {
    const defaultModelDeferred = createDeferred<AgentModelSelection | null>();
    const resolvedModel: AgentModelSelection = {
      providerId: "openai",
      modelId: "gpt-5",
    };
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
    adapter.startSession = async () => ({
      sessionId: "session-created",
      externalSessionId: "external-created",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
    });

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById,
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => defaultModelDeferred.promise,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const startPromise = start({ taskId: "task-1", role: "build", requireModelReady: true });
      const beforeModelReady = await withTimeout(startPromise, 20);
      expect(beforeModelReady).toBe("timeout");

      defaultModelDeferred.resolve(resolvedModel);
      await expect(startPromise).resolves.toBe("session-created");
      expect(sessionsState["session-created"]?.selectedModel).toEqual(resolvedModel);
    } finally {
      defaultModelDeferred.resolve(null);
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("requireModelReady falls back to null model when default-model loading fails", async () => {
    const defaultModelDeferred = createDeferred<AgentModelSelection | null>();
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
    adapter.startSession = async () => ({
      sessionId: "session-created",
      externalSessionId: "external-created",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
    });

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById,
      sessionsRef: { current: {} },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => defaultModelDeferred.promise,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const startPromise = start({ taskId: "task-1", role: "build", requireModelReady: true });
      defaultModelDeferred.reject(new Error("catalog unavailable"));
      await expect(startPromise).resolves.toBe("session-created");
      expect(sessionsState["session-created"]?.selectedModel).toBeNull();
    } finally {
      defaultModelDeferred.resolve(null);
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });
});
