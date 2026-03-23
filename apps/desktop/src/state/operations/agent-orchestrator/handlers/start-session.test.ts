import { beforeEach, describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { clearAppQueryClient } from "@/lib/query-client";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../shared/host";
import { createDeferred, createTaskCardFixture, withTimeout } from "../test-utils";
import { createStartAgentSession } from "./start-session";
import {
  type FlatStartSessionDependencies,
  toStartSessionDependencies,
} from "./start-session.test-helpers";

const createStartAgentSessionWithFlatDeps = (deps: FlatStartSessionDependencies) => {
  return createStartAgentSession(toStartSessionDependencies(deps));
};

const persistedSessionRecord = (
  input: {
    sessionId: string;
    externalSessionId: string;
    role: AgentSessionRecord["role"];
    scenario: AgentSessionRecord["scenario"];
    startedAt: string;
    workingDirectory: string;
    runtimeKind?: AgentSessionRecord["runtimeKind"];
    selectedModel?: AgentSessionRecord["selectedModel"];
  } & Record<string, unknown>,
): AgentSessionRecord => ({
  runtimeKind: input.runtimeKind ?? "opencode",
  sessionId: input.sessionId,
  externalSessionId: input.externalSessionId,
  role: input.role,
  scenario: input.scenario,
  startedAt: input.startedAt,
  workingDirectory: input.workingDirectory,
  selectedModel: input.selectedModel ?? null,
});

const withCapturedConsoleError = async (
  run: (calls: unknown[][]) => Promise<void>,
): Promise<void> => {
  const originalError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    await run(calls);
  } finally {
    console.error = originalError;
  }
};

const taskFixture = createTaskCardFixture({
  title: "Implement feature",
  description: "desc",
  status: "in_progress",
  priority: 1,
});

describe("agent-orchestrator/handlers/start-session", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
  });

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
        kind: "opencode",
        runtimeId: "runtime-2",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
      ["/tmp/repo::task-1::build::reuse::::::", inFlight],
    ]);
    const sessionsRef = { current: {} };
    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter: new OpencodeSdkAdapter(),
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: inFlightMap },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "reuse",
      }),
    ).resolves.toBe("session-in-flight");
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
        runtimeKind: "opencode",
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
        kind: "opencode",
        runtimeId: "runtime-1",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
            runtimeKind: "opencode",
            sessionId: "newer",
            externalSessionId: "external-newer",
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
            runId: "run-2",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
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
            isLoadingModelCatalog: false,
          },
        },
      },
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveBuildContinuationTarget: async () => "/tmp/repo/worktree",
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "reuse",
        }),
      ).resolves.toBe("newer");
      expect(persistedListCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses the explicitly selected in-memory session instead of the latest one", async () => {
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
          latest: {
            runtimeKind: "opencode",
            sessionId: "latest",
            externalSessionId: "external-latest",
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
            runId: "run-2",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
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
            isLoadingModelCatalog: false,
          },
          chosen: {
            runtimeKind: "opencode",
            sessionId: "chosen",
            externalSessionId: "external-chosen",
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:00:00.000Z",
            runtimeId: null,
            runId: "run-1",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
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
            isLoadingModelCatalog: false,
          },
        },
      },
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveBuildContinuationTarget: async () => "/tmp/repo/worktree",
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "reuse",
          sourceSessionId: "chosen",
        }),
      ).resolves.toBe("chosen");
      expect(persistedListCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("starts a fresh build session instead of reusing an in-memory session when the continuation target changed", async () => {
    let persistedListCalls = 0;
    let startCalls = 0;
    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => {
      persistedListCalls += 1;
      return [];
    };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      return {
        runtimeKind: "opencode",
        sessionId: "fresh-build-session",
        externalSessionId: "external-fresh-build-session",
        startedAt: "2026-02-22T08:20:00.000Z",
        role: input.role,
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: {
        current: {
          stale: {
            runtimeKind: "opencode",
            sessionId: "stale",
            externalSessionId: "external-stale",
            taskId: "task-1",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
            runId: "run-old",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/old-worktree",
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
            isLoadingModelCatalog: false,
          },
        },
      },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveBuildContinuationTarget: async () => "/tmp/repo/new-worktree",
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:5555",
        workingDirectory: "/tmp/repo/new-worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(start({ taskId: "task-1", role: "build" })).resolves.toBe("fresh-build-session");
      expect(startCalls).toBe(1);
      expect(persistedListCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("applies selected model immediately when reusing an in-memory session", async () => {
    const selectedModel: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    };
    let persistedSessions = 0;
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        reused: {
          runtimeKind: "opencode",
          sessionId: "reused",
          externalSessionId: "external-reused",
          taskId: "task-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          status: "idle",
          startedAt: "2026-02-22T08:10:00.000Z",
          runtimeId: null,
          runId: "run-2",
          runtimeEndpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
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
          isLoadingModelCatalog: false,
        },
      },
    };
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      sessionsRef.current = typeof updater === "function" ? updater(sessionsRef.current) : updater;
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter: new OpencodeSdkAdapter(),
      setSessionsById,
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveBuildContinuationTarget: async () => "/tmp/repo/worktree",
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {
        persistedSessions += 1;
      },
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "reuse",
          selectedModel,
        }),
      ).resolves.toBe("reused");
      expect(sessionsRef.current.reused?.selectedModel).toEqual(selectedModel);
      expect(persistedSessions).toBe(1);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("starts a fresh session instead of reusing when selected runtime differs in memory", async () => {
    const selectedModel: AgentModelSelection = {
      runtimeKind: "claude-code",
      providerId: "anthropic",
      modelId: "claude-3-7-sonnet",
      profileId: "Hephaestus",
    };
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      expect(input.model).toEqual(selectedModel);
      return {
        runtimeKind: "claude-code",
        sessionId: "fresh-runtime-session",
        externalSessionId: "fresh-runtime-external",
        startedAt: "2026-02-22T08:30:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: {
        current: {
          reused: {
            runtimeKind: "opencode",
            sessionId: "reused",
            externalSessionId: "external-reused",
            taskId: "task-1",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
            runId: "run-2",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
            messages: [],
            draftAssistantText: "",
            draftAssistantMessageId: null,
            draftReasoningText: "",
            draftReasoningMessageId: null,
            pendingPermissions: [],
            pendingQuestions: [],
            todos: [],
            modelCatalog: null,
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              profileId: "Ares",
            },
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
        kind: "claude-code",
        runtimeId: "runtime-claude",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:5555",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(start({ taskId: "task-1", role: "build", selectedModel })).resolves.toBe(
        "fresh-runtime-session",
      );
      expect(startCalls).toBe(1);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("starts a fresh session instead of reusing when selected agent profile differs", async () => {
    const selectedModel: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    };
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      expect(input.model).toEqual(selectedModel);
      return {
        runtimeKind: "opencode",
        sessionId: "fresh-profile-session",
        externalSessionId: "fresh-profile-external",
        startedAt: "2026-02-22T08:35:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: {
        current: {
          reused: {
            runtimeKind: "opencode",
            sessionId: "reused",
            externalSessionId: "external-reused",
            taskId: "task-1",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
            runId: "run-2",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
            messages: [],
            draftAssistantText: "",
            draftAssistantMessageId: null,
            draftReasoningText: "",
            draftReasoningMessageId: null,
            pendingPermissions: [],
            pendingQuestions: [],
            todos: [],
            modelCatalog: null,
            selectedModel: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
              profileId: "Sisyphus",
            },
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
        kind: "opencode",
        runtimeId: "runtime-2",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(start({ taskId: "task-1", role: "build", selectedModel })).resolves.toBe(
        "fresh-profile-session",
      );
      expect(startCalls).toBe(1);
    } finally {
      adapter.startSession = originalStartSession;
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
        runtimeKind: "opencode",
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
        persistedSessionRecord({
          runtimeKind: "opencode",
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
          runtimeEndpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        }),
      ];
    };

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: {
        current: {
          existingBuild: {
            runtimeKind: "opencode",
            sessionId: "existing-build",
            externalSessionId: "existing-build-ext",
            taskId: "task-1",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
            runId: "run-1",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-2",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
        runtimeKind: "opencode",
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
          runtimeKind: "opencode",
          sessionId: "existing-spec",
          externalSessionId: "existing-spec-ext",
          taskId: "task-1",
          role: "spec",
          scenario: "spec_initial",
          status: "idle",
          startedAt: "2026-02-22T08:10:00.000Z",
          runtimeId: null,
          runId: "run-1",
          runtimeEndpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-2",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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

  test("returns the requested persisted session for the same role and hydrates when missing from memory", async () => {
    let loadAgentSessionsCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "persisted-2",
        externalSessionId: "external-2",
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        status: "idle",
        startedAt: "2026-02-22T08:20:00.000Z",
        updatedAt: "2026-02-22T08:20:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-2",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "persisted-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        updatedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "persisted-build-newer",
        externalSessionId: "external-build-newer",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:30:00.000Z",
        updatedAt: "2026-02-22T08:30:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-3",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ];

    const sessionsRef = { current: {} };
    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter: new OpencodeSdkAdapter(),
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveBuildContinuationTarget: async () => "/tmp/repo/worktree",
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
        sessionsRef.current = {
          "persisted-build-newer": {
            runtimeKind: "opencode",
            sessionId: "persisted-build-newer",
            externalSessionId: "external-build-newer",
            taskId: "task-1",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:30:00.000Z",
            runtimeId: "runtime-1",
            runId: "run-3",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
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
            isLoadingModelCatalog: false,
          },
        };
      },
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const sessionId = await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "reuse",
        sourceSessionId: "persisted-build-newer",
      });
      expect(sessionId).toBe("persisted-build-newer");
      expect(loadAgentSessionsCalls).toBe(1);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("forks from the selected source session for pull request generation", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const persistedSnapshots: AgentSessionState[] = [];
    let sessionsById: Record<string, AgentSessionState> = {
      "source-build": {
        runtimeKind: "opencode",
        sessionId: "source-build",
        externalSessionId: "external-source-build",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-2",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
        messages: [],
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "builder",
        },
        isLoadingModelCatalog: false,
      },
    };

    adapter.forkSession = async (input) => {
      expect(input.taskId).toBe("task-1");
      expect(input.role).toBe("build");
      expect(input.scenario).toBe("build_pull_request_generation");
      expect(input.parentExternalSessionId).toBe("external-source-build");
      expect(input.runtimeConnection).toEqual({
        endpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      });
      return {
        runtimeKind: "opencode",
        sessionId: "forked-pr-session",
        externalSessionId: "external-forked-pr-session",
        startedAt: "2026-02-22T08:20:00.000Z",
        role: "build",
        scenario: "build_pull_request_generation",
        status: "idle",
      };
    };

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        sessionsById = typeof updater === "function" ? updater(sessionsById) : updater;
      },
      sessionsRef: { current: sessionsById },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
        runId: "run-2",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async (session) => {
        persistedSnapshots.push(session);
      },
      sendAgentMessage: async () => {},
    });

    try {
      const sessionId = await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_pull_request_generation",
        startMode: "fork",
        sourceSessionId: "source-build",
      });

      expect(sessionId).toBe("forked-pr-session");
      expect(sessionsById["forked-pr-session"]?.scenario).toBe("build_pull_request_generation");
      expect(sessionsById["forked-pr-session"]?.workingDirectory).toBe("/tmp/repo/worktree");
      expect(persistedSnapshots).toHaveLength(1);
      expect(persistedSnapshots[0]?.sessionId).toBe("forked-pr-session");
    } finally {
      adapter.forkSession = originalForkSession;
    }
  });

  test("starts a fresh session instead of reusing persisted session when selected runtime differs", async () => {
    const selectedModel: AgentModelSelection = {
      runtimeKind: "claude-code",
      providerId: "anthropic",
      modelId: "claude-3-7-sonnet",
      profileId: "Hephaestus",
    };
    let loadAgentSessionsCalls = 0;
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      startCalls += 1;
      expect(input.model).toEqual(selectedModel);
      return {
        runtimeKind: "claude-code",
        sessionId: "fresh-runtime-session",
        externalSessionId: "fresh-runtime-external",
        startedAt: "2026-02-22T08:40:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [
      persistedSessionRecord({
        runtimeKind: "opencode",
        sessionId: "persisted-opencode",
        externalSessionId: "external-opencode",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:20:00.000Z",
        updatedAt: "2026-02-22T08:20:00.000Z",
        runtimeId: "runtime-1",
        runId: "run-2",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "Ares",
        },
      }),
    ];

    const sessionsRef = { current: {} };
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
        kind: "claude-code",
        runtimeId: "runtime-claude",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:5555",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
        sessionsRef.current = {
          "persisted-claude": {
            runtimeKind: "claude-code",
            sessionId: "persisted-claude",
            externalSessionId: "external-claude",
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:20:00.000Z",
            runtimeId: "runtime-1",
            runId: "run-2",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
            messages: [],
            draftAssistantText: "",
            draftAssistantMessageId: null,
            draftReasoningText: "",
            draftReasoningMessageId: null,
            pendingPermissions: [],
            pendingQuestions: [],
            todos: [],
            modelCatalog: null,
            selectedModel: {
              runtimeKind: "claude-code",
              providerId: "anthropic",
              modelId: "claude-3-7-sonnet",
              profileId: "Hephaestus",
            },
            isLoadingModelCatalog: false,
          },
        };
      },
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(start({ taskId: "task-1", role: "build", selectedModel })).resolves.toBe(
        "fresh-runtime-session",
      );
      expect(loadAgentSessionsCalls).toBe(0);
      expect(startCalls).toBe(1);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses the requested persisted session when runtime kind is only present on selected model", async () => {
    let loadAgentSessionsCalls = 0;
    let startCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => {
      startCalls += 1;
      return {
        runtimeKind: "claude-code",
        sessionId: "fresh-runtime-session",
        externalSessionId: "fresh-runtime-external",
        startedAt: "2026-02-22T08:40:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () =>
      [
        {
          sessionId: "persisted-claude",
          externalSessionId: "external-claude",
          taskId: "task-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          status: "idle",
          startedAt: "2026-02-22T08:20:00.000Z",
          updatedAt: "2026-02-22T08:20:00.000Z",
          runtimeId: "runtime-1",
          runId: "run-2",
          runtimeEndpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
          selectedModel: {
            runtimeKind: "claude-code",
            providerId: "anthropic",
            modelId: "claude-3-7-sonnet",
            profileId: "Hephaestus",
          },
        },
      ] as unknown as Awaited<ReturnType<typeof host.agentSessionsList>>;

    const sessionsRef = { current: {} };
    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveBuildContinuationTarget: async () => "/tmp/repo/worktree",
      ensureRuntime: async () => ({
        kind: "claude-code",
        runtimeId: "runtime-claude",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:5555",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
        sessionsRef.current = {
          "persisted-claude": {
            runtimeKind: "claude-code",
            sessionId: "persisted-claude",
            externalSessionId: "external-claude",
            taskId: "task-1",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:20:00.000Z",
            runtimeId: "runtime-1",
            runId: "run-2",
            runtimeEndpoint: "http://127.0.0.1:4444",
            workingDirectory: "/tmp/repo/worktree",
            messages: [],
            draftAssistantText: "",
            draftAssistantMessageId: null,
            draftReasoningText: "",
            draftReasoningMessageId: null,
            pendingPermissions: [],
            pendingQuestions: [],
            todos: [],
            modelCatalog: null,
            selectedModel: {
              runtimeKind: "claude-code",
              providerId: "anthropic",
              modelId: "claude-3-7-sonnet",
              profileId: "Hephaestus",
            },
            isLoadingModelCatalog: false,
          },
        };
      },
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const sessionId = await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "reuse",
        sourceSessionId: "persisted-claude",
        selectedModel: {
          runtimeKind: "claude-code",
          providerId: "anthropic",
          modelId: "claude-3-7-sonnet",
        },
      });
      expect(sessionId).toBe("persisted-claude");
      expect(loadAgentSessionsCalls).toBe(1);
      expect(startCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
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
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
          kind: "opencode",
          runtimeId: null,
          runId: null,
          runtimeEndpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo",
        };
      },
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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

  test("rejects qa start before resolving a review target when qa is unavailable", async () => {
    let qaTargetCalls = 0;

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
      resolveBuildContinuationTarget: async () => {
        qaTargetCalls += 1;
        return "/tmp/repo/worktree";
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(start({ taskId: "task-1", role: "qa" })).rejects.toThrow(
        "Role 'qa' is unavailable for task 'task-1' in status 'open'.",
      );
      expect(qaTargetCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("uses explicit builder context for qa start without resolving a continuation target", async () => {
    let qaTargetCalls = 0;
    const ensuredWorkingDirectories: Array<string | null | undefined> = [];
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => ({
      sessionId: "session-qa",
      externalSessionId: "external-qa",
      role: input.role,
      scenario: input.scenario,
      startedAt: "2026-02-22T08:00:00.000Z",
      status: "idle",
      runtimeKind: input.runtimeKind,
    });

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            status: "human_review",
            agentWorkflows: {
              spec: { required: false, canSkip: true, available: true, completed: true },
              planner: { required: false, canSkip: true, available: true, completed: true },
              builder: { required: true, canSkip: false, available: true, completed: true },
              qa: { required: true, canSkip: false, available: true, completed: false },
            },
          }),
        ],
      },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveBuildContinuationTarget: async () => {
        qaTargetCalls += 1;
        return "/tmp/repo/unexpected";
      },
      ensureRuntime: async (_repoPath, _taskId, _role, options) => {
        ensuredWorkingDirectories.push(options?.workingDirectoryOverride);
        return {
          kind: "opencode",
          runtimeId: null,
          runId: null,
          runtimeEndpoint: "http://127.0.0.1:4444",
          workingDirectory: options?.workingDirectoryOverride ?? "/tmp/repo",
        };
      },
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "qa",
          startMode: "fresh",
          builderContext: {
            workingDirectory: "/tmp/repo/worktree",
          },
        }),
      ).resolves.toBe("session-qa");
      expect(qaTargetCalls).toBe(0);
      expect(ensuredWorkingDirectories).toEqual(["/tmp/repo/worktree"]);
    } finally {
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
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
      runtimeKind: "opencode",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
        runtimeKind: "opencode",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
        runtimeKind: "opencode",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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

  test("surfaces stale-start cleanup failures instead of masking them", async () => {
    const previousRepoRef = { current: "/tmp/repo" as string | null };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    const originalStopSession = adapter.stopSession;
    adapter.startSession = async () => {
      previousRepoRef.current = "/tmp/other";
      return {
        runtimeKind: "opencode",
        sessionId: "session-created",
        externalSessionId: "external-created",
        startedAt: "2026-02-22T08:00:10.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };
    adapter.stopSession = async () => {
      throw new Error("stop boom");
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(start({ taskId: "task-1", role: "build" })).rejects.toThrow(
          "Workspace changed while starting session. Failed to stop stale started session 'session-created': stop boom",
        );
        expect(calls).toHaveLength(1);
        expect(String(calls[0]?.[1] ?? "")).toBe("start-session-stop-on-stale-after-start");
      });
    } finally {
      adapter.startSession = originalStartSession;
      adapter.stopSession = originalStopSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("creates a fresh session and triggers kickoff flow", async () => {
    let attachCalls = 0;
    let persistCalls = 0;
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
        runtimeKind: "opencode",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
      expect(kickoffCalls).toBe(1);
      expect(refreshCalls).toBe(1);
      expect(Object.keys(sessionsState)).toContain("session-created");
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("defers default-model loading until after session start when model readiness is optional", async () => {
    const docsDeferred = createDeferred<{
      specMarkdown: string;
      planMarkdown: string;
      qaMarkdown: string;
    }>();
    let runtimeCalls = 0;
    const runtimeStarted = createDeferred<void>();
    const defaultModelStarted = createDeferred<void>();
    let defaultModelCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => ({
      runtimeKind: "opencode",
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
        runtimeStarted.resolve();
        return {
          kind: "opencode",
          runtimeId: null,
          runId: "run-1",
          runtimeEndpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadTaskDocuments: async () => docsDeferred.promise,
      loadRepoDefaultModel: async () => {
        defaultModelCalls += 1;
        defaultModelStarted.resolve();
        return null;
      },
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const startPromise = start({ taskId: "task-1", role: "build" });
      await Promise.resolve();
      expect(defaultModelCalls).toBe(0);
      expect(runtimeCalls).toBe(0);

      docsDeferred.resolve({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" });
      await withTimeout(runtimeStarted.promise, 50);
      expect(runtimeCalls).toBe(1);
      await expect(startPromise).resolves.toBe("session-created");
      await withTimeout(defaultModelStarted.promise, 50);
      expect(defaultModelCalls).toBe(1);
    } finally {
      docsDeferred.resolve({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" });
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("does not start a runtime when prompt loading fails", async () => {
    let runtimeCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => {
      throw new Error("startSession should not be reached");
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
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          kind: "opencode",
          runtimeId: null,
          runId: "run-1",
          runtimeEndpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadTaskDocuments: async () => {
        throw new Error("prompt load failed");
      },
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(start({ taskId: "task-1", role: "build" })).rejects.toThrow(
        "prompt load failed",
      );
      expect(runtimeCalls).toBe(0);
    } finally {
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
      runtimeKind: "opencode",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
      runtimeKind: "opencode",
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
      runtimeKind: "opencode",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => defaultModelDeferred.promise,
      loadRepoPromptOverrides: async () => ({}),
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

  test("passes the selected model to adapter session creation", async () => {
    const selectedModel: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    };
    let observedStartInput: { model?: AgentModelSelection } | null = null;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async (input) => {
      observedStartInput = input;
      return {
        runtimeKind: "opencode",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          selectedModel,
          startMode: "fresh",
        }),
      ).resolves.toBe("session-created");
      if (observedStartInput === null) {
        throw new Error("Expected adapter.startSession to receive input.");
      }
      expect(observedStartInput).toMatchObject({ model: selectedModel });
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("requireModelReady propagates default-model loading failures", async () => {
    const defaultModelDeferred = createDeferred<AgentModelSelection | null>();
    let sessionsState: Record<string, AgentSessionState> = {};
    let persistedSessions = 0;
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      sessionsState = typeof updater === "function" ? updater(sessionsState) : updater;
    };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    let startSessionCalls = 0;
    adapter.startSession = async () => {
      startSessionCalls += 1;
      return {
        runtimeKind: "opencode",
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
        kind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => defaultModelDeferred.promise,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {
        persistedSessions += 1;
      },
      sendAgentMessage: async () => {},
    });

    try {
      const startPromise = start({ taskId: "task-1", role: "build", requireModelReady: true });
      defaultModelDeferred.reject(new Error("catalog unavailable"));
      await expect(startPromise).rejects.toThrow(
        "Failed to load the default model for build session start: catalog unavailable",
      );
      expect(startSessionCalls).toBe(0);
      expect(persistedSessions).toBe(0);
      expect(sessionsState["session-created"]).toBeUndefined();
    } finally {
      defaultModelDeferred.resolve(null);
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });
});
