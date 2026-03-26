import { beforeEach, describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentEnginePort, AgentModelSelection } from "@openducktor/core";
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

const continuationTarget = (
  workingDirectory: string,
  source: "active_build_run" | "builder_session" = "active_build_run",
) => ({
  workingDirectory,
  source,
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

const BUILD_SELECTION: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build",
};

const PLANNER_SELECTION: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "planner",
};

const QA_SELECTION: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "qa",
};

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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    expect(
      start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      }),
    ).rejects.toThrow("Select a workspace first.");
  });

  test("reuses an existing in-flight start promise", async () => {
    const inFlight = Promise.resolve("session-in-flight");
    const inFlightMap = new Map<string, Promise<string>>([
      [
        "/tmp/repo::task-1::build::reuse::session-in-flight::::::build_after_human_request_changes::no-kickoff",
        inFlight,
      ],
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "reuse",
        sourceSessionId: "session-in-flight",
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const buildPromise = start({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });
      await Promise.resolve();
      const plannerPromise = start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      });
      await buildStarted.promise;
      const plannerStartResult = await withTimeout(plannerStarted.promise, 50);

      expect(new Set(startedRoles)).toEqual(new Set(["build", "planner"]));
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

  test("does not dedupe fresh starts with different scenarios, models, or kickoff flags", async () => {
    const modelSession = Promise.resolve("session-model");
    const scenarioSession = Promise.resolve("session-scenario");
    const kickoffSession = Promise.resolve("session-kickoff");
    const inFlightMap = new Map<string, Promise<string>>([
      [
        "/tmp/repo::task-1::build::fresh::::/tmp/repo/worktree::opencode::openai::gpt-5::default::build::build_after_human_request_changes::no-kickoff",
        modelSession,
      ],
      [
        "/tmp/repo::task-1::build::fresh::::/tmp/repo/worktree::opencode::openai::gpt-5::default::build::build_pull_request_generation::no-kickoff",
        scenarioSession,
      ],
      [
        "/tmp/repo::task-1::build::fresh::::/tmp/repo/worktree::opencode::openai::gpt-5::default::build::build_after_human_request_changes::kickoff",
        kickoffSession,
      ],
      [
        "/tmp/repo::task-1::build::fresh::::/tmp/repo/worktree::opencode::openai::gpt-5::default::planner::build_after_human_request_changes::no-kickoff",
        Promise.resolve("session-profile"),
      ],
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      }),
    ).resolves.toBe("session-model");

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        scenario: "build_pull_request_generation",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      }),
    ).resolves.toBe("session-scenario");

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
        sendKickoff: true,
      }),
    ).resolves.toBe("session-kickoff");

    await expect(
      start({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "fresh",
        selectedModel: {
          ...BUILD_SELECTION,
          profileId: "planner",
        },
      }),
    ).resolves.toBe("session-profile");
  });

  test("waits for the initial session snapshot to persist before resolving", async () => {
    const persistDeferred = createDeferred<void>();
    let sessionsById: Record<string, AgentSessionState> = {};
    const sessionsRef = { current: sessionsById };
    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => ({
      runtimeKind: "opencode",
      sessionId: "planner-session",
      externalSessionId: "external-planner-session",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "planner",
      scenario: "planner_initial",
      status: "idle",
    });

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        sessionsById = typeof updater === "function" ? updater(sessionsById) : updater;
        sessionsRef.current = sessionsById;
      },
      sessionsRef,
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
      persistSessionRecord: async () => {
        await persistDeferred.promise;
      },
      sendAgentMessage: async () => {},
    });

    try {
      const startPromise = start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      });

      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (Object.values(sessionsById).length === 1) {
          break;
        }
        await Promise.resolve();
        await Promise.resolve();
      }

      expect(Object.values(sessionsById)).toHaveLength(1);
      expect(Object.values(sessionsById)[0]?.status).toBe("starting");
      await expect(withTimeout(startPromise, 25)).resolves.toBe("timeout");

      persistDeferred.resolve();

      await expect(startPromise).resolves.toBe("planner-session");
    } finally {
      persistDeferred.resolve();
      adapter.startSession = originalStartSession;
    }
  });

  test("persists only durable session record fields during start", async () => {
    let persistedTaskId: string | null = null;
    let persistedRecord: AgentSessionRecord | null = null;
    const start = createStartAgentSession(
      toStartSessionDependencies({
        activeRepo: "/tmp/repo",
        repoEpochRef: { current: 1 },
        previousRepoRef: { current: "/tmp/repo" },
        setSessionsById: () => {},
        sessionsRef: { current: {} },
        inFlightStartsByRepoTaskRef: { current: new Map() },
        loadAgentSessions: async () => {},
        attachSessionListener: () => {},
        taskRef: { current: [createTaskCardFixture({ id: "task-1", status: "open" })] },
        adapter: {
          ...new OpencodeSdkAdapter(),
          startSession: async () => ({
            sessionId: "session-1",
            externalSessionId: "external-1",
            role: "planner",
            scenario: "planner_initial",
            startedAt: "2026-03-21T10:00:00.000Z",
            status: "running",
          }),
        } as unknown as AgentEnginePort,
        resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
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
        refreshTaskData: async () => {},
        persistSessionRecord: async (taskId, record) => {
          persistedTaskId = taskId;
          persistedRecord = record;
        },
        sendAgentMessage: async () => {},
      }),
    );

    await start({
      taskId: "task-1",
      role: "planner",
      startMode: "fresh",
      selectedModel: PLANNER_SELECTION,
    });

    if (persistedTaskId !== "task-1") {
      throw new Error(`Expected persisted task id task-1, received ${String(persistedTaskId)}`);
    }
    if (!persistedRecord) {
      throw new Error("Expected persisted record to be captured.");
    }
    const persistedSessionRecord = persistedRecord as AgentSessionRecord;

    expect(persistedSessionRecord.sessionId).toBe("session-1");
    expect("status" in persistedSessionRecord).toBe(false);
    expect("taskId" in persistedSessionRecord).toBe(false);
    expect("runtimeEndpoint" in persistedSessionRecord).toBe(false);
    expect("baseUrl" in persistedSessionRecord).toBe(false);
    expect("runtimeTransport" in persistedSessionRecord).toBe(false);
  });

  test("stops and removes the started session when initial persistence fails", async () => {
    const stoppedSessionIds: string[] = [];
    const attachedSessionIds: string[] = [];
    const sessionsRef = { current: {} as Record<string, AgentSessionState> };
    const adapter = new OpencodeSdkAdapter();
    adapter.startSession = async () => ({
      runtimeKind: "opencode",
      sessionId: "session-persist-fail",
      externalSessionId: "external-session-persist-fail",
      role: "planner",
      scenario: "planner_initial",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async (sessionId) => {
      stoppedSessionIds.push(sessionId);
    };

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        sessionsRef.current =
          typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
      sessionsRef,
      taskRef: { current: [{ ...taskFixture, id: "task-1" }] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: (_repoPath, sessionId) => {
        attachedSessionIds.push(sessionId);
      },
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
      persistSessionRecord: async () => {
        throw new Error("persist failed");
      },
      sendAgentMessage: async () => {},
    });

    await expect(
      start({
        taskId: "task-1",
        role: "planner",
        scenario: "planner_initial",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      }),
    ).rejects.toThrow(
      'Failed to persist started session "session-persist-fail": persist failed. The started session was stopped and removed locally.',
    );

    expect(stoppedSessionIds).toEqual(["session-persist-fail"]);
    expect(attachedSessionIds).toEqual([]);
    expect(sessionsRef.current["session-persist-fail"]).toBeUndefined();
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "reuse",
          sourceSessionId: "newer",
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
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
      persistSessionRecord: async () => {},
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/new-worktree"),
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).resolves.toBe("fresh-build-session");
      expect(startCalls).toBe(1);
      expect(persistedListCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses an in-memory build session when the continuation target only differs by trailing slash", async () => {
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
          chosen: {
            runtimeKind: "opencode",
            sessionId: "chosen",
            externalSessionId: "external-chosen",
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
            selectedModel: BUILD_SELECTION,
            isLoadingModelCatalog: false,
          },
        },
      },
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree/"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
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

  test("keeps existing selected model when reusing an in-memory session", async () => {
    let persistedSessions = 0;
    const existingSelectedModel: AgentModelSelection = {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "medium",
      profileId: "Sisyphus",
    };
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
          selectedModel: existingSelectedModel,
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
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
      persistSessionRecord: async () => {
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
          sourceSessionId: "reused",
        }),
      ).resolves.toBe("reused");
      expect(sessionsRef.current.reused?.selectedModel).toEqual(existingSelectedModel);
      expect(persistedSessions).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses in-memory session even when selected runtime differs", async () => {
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "reuse",
          sourceSessionId: "reused",
        }),
      ).resolves.toBe("reused");
      expect(startCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("reuses in-memory session even when selected agent profile differs", async () => {
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "reuse",
          sourceSessionId: "reused",
        }),
      ).resolves.toBe("reused");
      expect(startCalls).toBe(0);
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).resolves.toBe("fresh-session");
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const sessionId = await start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      });
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
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
      persistSessionRecord: async () => {},
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
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const persistedSnapshots: AgentSessionRecord[] = [];
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
    adapter.loadSessionHistory = async (input) => {
      expect(input.runtimeKind).toBe("opencode");
      expect(input.externalSessionId).toBe("external-forked-pr-session");
      return [
        {
          messageId: "fork-user-1",
          role: "user",
          timestamp: "2026-02-22T08:21:00.000Z",
          text: "Generate the PR summary.",
          parts: [],
        },
        {
          messageId: "fork-assistant-1",
          role: "assistant",
          timestamp: "2026-02-22T08:22:00.000Z",
          text: "I drafted the summary.",
          parts: [],
        },
      ];
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
      persistSessionRecord: async (_taskId, record) => {
        persistedSnapshots.push(record);
      },
      sendAgentMessage: async () => {},
    });

    try {
      const sessionId = await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_pull_request_generation",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceSessionId: "source-build",
      });

      expect(sessionId).toBe("forked-pr-session");
      expect(sessionsById["forked-pr-session"]?.scenario).toBe("build_pull_request_generation");
      expect(sessionsById["forked-pr-session"]?.workingDirectory).toBe("/tmp/repo/worktree");
      expect(sessionsById["forked-pr-session"]?.messages).toEqual([
        {
          id: "history:session-forked:forked-pr-session",
          role: "system",
          content: "Session forked (build - build_pull_request_generation)",
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "history:system-prompt:forked-pr-session",
          role: "system",
          content: expect.stringContaining("System prompt:"),
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "history:text:fork-user-1",
          role: "user",
          content: "Generate the PR summary.",
          timestamp: "2026-02-22T08:21:00.000Z",
        },
        {
          id: "history:text:fork-assistant-1",
          role: "assistant",
          content: "I drafted the summary.",
          timestamp: "2026-02-22T08:22:00.000Z",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
            providerId: "openai",
            modelId: "gpt-5",
            variant: "default",
            profileId: "build",
          },
        },
      ]);
      expect(persistedSnapshots).toHaveLength(1);
      expect(persistedSnapshots[0]?.sessionId).toBe("forked-pr-session");
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("hydrates a stopped source session before forking so inherited history is available immediately", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const loadAgentSessionsCalls: Array<{ taskId: string; targetSessionId?: string }> = [];
    let sessionsById: Record<string, AgentSessionState> = {
      "source-build": {
        runtimeKind: "opencode",
        sessionId: "source-build",
        externalSessionId: "external-source-build",
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        status: "stopped",
        startedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: null,
        runId: null,
        runtimeEndpoint: "",
        workingDirectory: "/tmp/repo/worktree",
        messages: [],
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: BUILD_SELECTION,
        isLoadingModelCatalog: false,
      },
    };

    adapter.forkSession = async () => ({
      runtimeKind: "opencode",
      sessionId: "forked-from-hydrated-source",
      externalSessionId: "external-forked-from-hydrated-source",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      scenario: "build_pull_request_generation",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => [
      {
        messageId: "child-user-1",
        role: "user",
        timestamp: "2026-02-22T08:21:00.000Z",
        text: "Hydrated child history",
        parts: [],
      },
    ];

    const sessionsRef = { current: sessionsById };
    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        sessionsById = typeof updater === "function" ? updater(sessionsById) : updater;
        sessionsRef.current = sessionsById;
      },
      sessionsRef,
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
      loadAgentSessions: async (taskId, options) => {
        const targetSessionId = options?.targetSessionId ?? undefined;
        loadAgentSessionsCalls.push(targetSessionId ? { taskId, targetSessionId } : { taskId });
        const sourceBuild = sessionsById["source-build"];
        if (!sourceBuild) {
          throw new Error("Missing source-build session");
        }
        sessionsById = {
          ...sessionsById,
          "source-build": {
            ...sourceBuild,
            status: "idle",
            runtimeId: "runtime-1",
            runId: "run-2",
            runtimeEndpoint: "http://127.0.0.1:4444",
            messages: [],
          },
        };
        sessionsRef.current = sessionsById;
      },
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const sessionId = await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_pull_request_generation",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceSessionId: "source-build",
      });

      expect(sessionId).toBe("forked-from-hydrated-source");
      expect(loadAgentSessionsCalls).toEqual([
        {
          taskId: "task-1",
          targetSessionId: "source-build",
        },
      ]);
      expect(sessionsById["forked-from-hydrated-source"]?.messages).toEqual([
        {
          id: "history:session-forked:forked-from-hydrated-source",
          role: "system",
          content: "Session forked (build - build_pull_request_generation)",
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "history:system-prompt:forked-from-hydrated-source",
          role: "system",
          content: expect.stringContaining("System prompt:"),
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "history:text:child-user-1",
          role: "user",
          content: "Hydrated child history",
          timestamp: "2026-02-22T08:21:00.000Z",
        },
      ]);
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("stops the forked session when child history hydration fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const originalStopSession = adapter.stopSession;
    const stoppedSessionIds: string[] = [];
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
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: BUILD_SELECTION,
        isLoadingModelCatalog: false,
      },
    };

    adapter.forkSession = async () => ({
      runtimeKind: "opencode",
      sessionId: "fork-history-failure",
      externalSessionId: "external-fork-history-failure",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      scenario: "build_pull_request_generation",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => {
      throw new Error("history unavailable");
    };
    adapter.stopSession = async (sessionId) => {
      stoppedSessionIds.push(sessionId);
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_pull_request_generation",
          startMode: "fork",
          selectedModel: BUILD_SELECTION,
          sourceSessionId: "source-build",
        }),
      ).rejects.toThrow(
        'Failed to initialize started session "fork-history-failure": history unavailable. The started session was stopped before local registration.',
      );
      expect(stoppedSessionIds).toEqual(["fork-history-failure"]);
      expect(sessionsById["fork-history-failure"]).toBeUndefined();
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
      adapter.stopSession = originalStopSession;
    }
  });

  test("stops the forked session when the repo becomes stale after child history hydration", async () => {
    const previousRepoRef = { current: "/tmp/repo" as string | null };
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const originalStopSession = adapter.stopSession;
    const stoppedSessionIds: string[] = [];
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
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: BUILD_SELECTION,
        isLoadingModelCatalog: false,
      },
    };
    const sessionsRef = { current: sessionsById };

    adapter.forkSession = async () => ({
      runtimeKind: "opencode",
      sessionId: "forked-stale-after-history",
      externalSessionId: "external-forked-stale-after-history",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      scenario: "build_pull_request_generation",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => {
      previousRepoRef.current = "/tmp/other";
      return [
        {
          messageId: "child-user-1",
          role: "user",
          timestamp: "2026-02-22T08:21:00.000Z",
          text: "Hydrated child history",
          parts: [],
        },
      ];
    };
    adapter.stopSession = async (sessionId) => {
      stoppedSessionIds.push(sessionId);
    };

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        sessionsById = typeof updater === "function" ? updater(sessionsById) : updater;
        sessionsRef.current = sessionsById;
      },
      sessionsRef,
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      previousRepoRef,
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_pull_request_generation",
          startMode: "fork",
          selectedModel: BUILD_SELECTION,
          sourceSessionId: "source-build",
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
      expect(stoppedSessionIds).toEqual(["forked-stale-after-history"]);
      expect(sessionsById["forked-stale-after-history"]).toBeUndefined();
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
      adapter.stopSession = originalStopSession;
    }
  });

  test("rejects cross-runtime fork requests before calling the adapter", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
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
          selectedModel: BUILD_SELECTION,
          isLoadingModelCatalog: false,
        },
      },
    };
    const forkCalls: unknown[] = [];
    adapter.forkSession = async (input) => {
      forkCalls.push(input);
      return {
        runtimeKind: "opencode",
        sessionId: "unexpected-fork",
        externalSessionId: "unexpected-external-fork",
        startedAt: "2026-02-22T08:20:00.000Z",
        role: "build",
        scenario: "build_pull_request_generation",
        status: "idle",
      };
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "claude-code",
        runtimeId: "runtime-2",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:5555",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_pull_request_generation",
          startMode: "fork",
          sourceSessionId: "source-build",
          selectedModel: {
            runtimeKind: "claude-code",
            providerId: "anthropic",
            modelId: "claude-sonnet-4",
            variant: "default",
            profileId: "build",
          },
        }),
      ).rejects.toThrow(
        'Session "source-build" cannot be forked with runtime "claude-code" because it belongs to runtime "opencode".',
      );
      expect(forkCalls).toHaveLength(0);
    } finally {
      adapter.forkSession = originalForkSession;
    }
  });

  test("reuses persisted session when selected runtime differs", async () => {
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
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
          "persisted-opencode": {
            runtimeKind: "opencode",
            sessionId: "persisted-opencode",
            externalSessionId: "external-opencode",
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
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              profileId: "Ares",
            },
            isLoadingModelCatalog: false,
          },
        };
      },
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "reuse",
          sourceSessionId: "persisted-opencode",
        }),
      ).resolves.toBe("persisted-opencode");
      expect(loadAgentSessionsCalls).toBe(1);
      expect(startCalls).toBe(0);
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
      resolveBuildContinuationTarget: async () => continuationTarget("/tmp/repo/worktree"),
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const sessionId = await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "reuse",
        sourceSessionId: "persisted-claude",
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Task not found: task-1");
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
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
        return continuationTarget("/tmp/repo/worktree");
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "qa",
          startMode: "fresh",
          selectedModel: QA_SELECTION,
        }),
      ).rejects.toThrow("Role 'qa' is unavailable for task 'task-1' in status 'open'.");
      expect(qaTargetCalls).toBe(0);
    } finally {
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("resolves the builder worktree target for qa start", async () => {
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
        return continuationTarget("/tmp/repo/worktree");
      },
      ensureRuntime: async (_repoPath, _taskId, _role, options) => {
        ensuredWorkingDirectories.push(options?.targetWorkingDirectory);
        return {
          kind: "opencode",
          runtimeId: null,
          runId: null,
          runtimeEndpoint: "http://127.0.0.1:4444",
          workingDirectory: options?.targetWorkingDirectory ?? "/tmp/repo",
        };
      },
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "qa",
          startMode: "fresh",
          selectedModel: QA_SELECTION,
        }),
      ).resolves.toBe("session-qa");
      expect(qaTargetCalls).toBe(1);
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await withCapturedConsoleError(async (calls) => {
        await expect(
          start({
            taskId: "task-1",
            role: "build",
            startMode: "fresh",
            selectedModel: BUILD_SELECTION,
          }),
        ).rejects.toThrow(
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
      persistSessionRecord: async () => {
        persistCalls += 1;
      },
      sendAgentMessage: async () => {
        kickoffCalls += 1;
      },
    });

    try {
      const sessionId = await start({
        taskId: "task-1",
        role: "build",
        sendKickoff: true,
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });
      expect(sessionId).toBe("session-created");
      expect(startCalls).toBe(1);
      expect(attachCalls).toBe(1);
      expect(persistCalls).toBe(1);
      expect(kickoffCalls).toBe(1);
      expect(refreshCalls).toBe(1);
      expect(Object.keys(sessionsState)).toContain("session-created");
      expect(sessionsState["session-created"]?.messages[0]).toEqual({
        id: "history:session-start:session-created",
        role: "system",
        content: "Session started (build - build_implementation_start)",
        timestamp: "2026-02-22T08:00:10.000Z",
      });
    } finally {
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      await expect(
        start({
          taskId: "task-1",
          role: "build",
          startMode: "fresh",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow("prompt load failed");
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
      persistSessionRecord: async () => {},
      sendAgentMessage: async () => {},
    });

    try {
      const startPromise = start({
        taskId: "task-1",
        role: "build",
        sendKickoff: true,
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });
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
      persistSessionRecord: async () => {},
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
});
