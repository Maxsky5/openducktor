import { beforeEach, describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentEnginePort, AgentModelSelection } from "@openducktor/core";
import { appQueryClient, clearAppQueryClient } from "@/lib/query-client";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { withCapturedConsole } from "@/test-utils/console-capture";
import {
  sessionMessageAt,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState as BaseAgentSessionState } from "@/types/agent-orchestrator";
import { host } from "../../shared/host";
import { createDeferred, createTaskCardFixture, withTimeout } from "../test-utils";
import { createStartAgentSession } from "./start-session";
import {
  type FlatStartSessionDependencies,
  toStartSessionDependencies,
} from "./start-session.test-helpers";

type AgentSessionState = BaseAgentSessionState & { runId?: string | null };

const createStartAgentSessionWithFlatDeps = (deps: FlatStartSessionDependencies) => {
  return createStartAgentSession(toStartSessionDependencies(deps));
};

const persistedSessionRecord = (
  input: {
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

const setPersistedSessionListFixture = (
  repoPath: string,
  taskId: string,
  sessions: AgentSessionRecord[],
): void => {
  appQueryClient.setQueryData(agentSessionQueryKeys.list(repoPath, taskId), sessions);
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
      currentWorkspaceRepoPathRef: { current: null },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: inFlightMap },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
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
        sourceExternalSessionId: "session-in-flight",
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
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
      await expect(buildPromise).resolves.toBe("build-external");
      await expect(plannerPromise).resolves.toBe("planner-external");
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: inFlightMap },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
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
      externalSessionId: "planner-external",
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
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

      await expect(startPromise).resolves.toBe("planner-external");
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
        activeWorkspaceId: "workspace-1",
        repoEpochRef: { current: 1 },
        currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
        setSessionsById: () => {},
        sessionsRef: { current: {} },
        inFlightStartsByWorkspaceTaskRef: { current: new Map() },
        loadAgentSessions: async () => {},
        attachSessionListener: () => {},
        taskRef: { current: [createTaskCardFixture({ id: "task-1", status: "open" })] },
        adapter: {
          ...new OpencodeSdkAdapter(),
          startSession: async () => ({
            externalSessionId: "external-1",
            role: "planner",
            scenario: "planner_initial",
            startedAt: "2026-03-21T10:00:00.000Z",
            status: "running",
          }),
        } as unknown as AgentEnginePort,
        resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
        ensureRuntime: async () => ({
          kind: "opencode",
          runtimeId: "runtime-1",
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

    expect(persistedSessionRecord.externalSessionId).toBe("external-1");
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
      externalSessionId: "external-session-persist-fail",
      role: "planner",
      scenario: "planner_initial",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
    });
    adapter.stopSession = async (externalSessionId) => {
      stoppedSessionIds.push(externalSessionId);
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: (_repoPath, externalSessionId) => {
        attachedSessionIds.push(externalSessionId);
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
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

    await withCapturedConsole("error", async (calls) => {
      await expect(
        start({
          taskId: "task-1",
          role: "planner",
          scenario: "planner_initial",
          startMode: "fresh",
          selectedModel: PLANNER_SELECTION,
        }),
      ).rejects.toThrow(
        'Failed to persist started session "external-session-persist-fail": persist failed. The started session was stopped and removed locally.',
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe("[agent-orchestrator]");
      expect(calls[0]?.[1]).toBe("start-session-persist-initial-session");
    });

    expect(stoppedSessionIds).toEqual(["external-session-persist-fail"]);
    expect(attachedSessionIds).toEqual([]);
    expect(sessionsRef.current["external-session-persist-fail"]).toBeUndefined();
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
          "external-newer": {
            runtimeKind: "opencode",
            externalSessionId: "external-newer",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
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
          sourceExternalSessionId: "external-newer",
        }),
      ).resolves.toBe("external-newer");
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
            externalSessionId: "external-latest",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
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
          "external-chosen": {
            runtimeKind: "opencode",
            externalSessionId: "external-chosen",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:00:00.000Z",
            runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
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
          sourceExternalSessionId: "external-chosen",
        }),
      ).resolves.toBe("external-chosen");
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
            externalSessionId: "external-stale",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/new-worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
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
      ).resolves.toBe("external-fresh-build-session");
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
          "external-chosen": {
            runtimeKind: "opencode",
            externalSessionId: "external-chosen",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree/"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
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
          sourceExternalSessionId: "external-chosen",
        }),
      ).resolves.toBe("external-chosen");
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
        "external-reused": {
          runtimeKind: "opencode",
          externalSessionId: "external-reused",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          scenario: "build_after_human_request_changes",
          status: "idle",
          startedAt: "2026-02-22T08:10:00.000Z",
          runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
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
          sourceExternalSessionId: "external-reused",
        }),
      ).resolves.toBe("external-reused");
      expect(sessionsRef.current["external-reused"]?.selectedModel).toEqual(existingSelectedModel);
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
          "external-reused": {
            runtimeKind: "opencode",
            externalSessionId: "external-reused",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "claude-code",
        runtimeId: "runtime-claude",
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
          sourceExternalSessionId: "external-reused",
        }),
      ).resolves.toBe("external-reused");
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
          "external-reused": {
            runtimeKind: "opencode",
            externalSessionId: "external-reused",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-2",
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
          sourceExternalSessionId: "external-reused",
        }),
      ).resolves.toBe("external-reused");
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
          externalSessionId: "persisted-build-ext",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
          startedAt: "2026-02-22T08:20:00.000Z",
          updatedAt: "2026-02-22T08:20:00.000Z",
          runtimeId: "runtime-1",
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
            externalSessionId: "existing-build-ext",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:10:00.000Z",
            runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
      ).resolves.toBe("fresh-ext");
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
          externalSessionId: "existing-spec-ext",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "spec",
          scenario: "spec_initial",
          status: "idle",
          startedAt: "2026-02-22T08:10:00.000Z",
          runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
      const externalSessionId = await start({
        taskId: "task-1",
        role: "planner",
        startMode: "fresh",
        selectedModel: PLANNER_SELECTION,
      });
      expect(externalSessionId).toBe("planner-ext");
      expect(startCalls).toBe(1);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("returns the requested persisted session for the same role and hydrates when missing from memory", async () => {
    let loadAgentSessionsCalls = 0;

    setPersistedSessionListFixture("/tmp/repo", "task-1", [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-2",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_after_human_request_changes",
        startedAt: "2026-02-22T08:20:00.000Z",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_after_human_request_changes",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        updatedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-build-newer",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:30:00.000Z",
        updatedAt: "2026-02-22T08:30:00.000Z",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ]);

    const sessionsRef = { current: {} };
    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter: new OpencodeSdkAdapter(),
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
        sessionsRef.current = {
          "external-build-newer": {
            runtimeKind: "opencode",
            externalSessionId: "external-build-newer",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_implementation_start",
            status: "idle",
            startedAt: "2026-02-22T08:30:00.000Z",
            runtimeId: "runtime-1",
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

    const externalSessionId = await start({
      taskId: "task-1",
      role: "build",
      scenario: "build_after_human_request_changes",
      startMode: "reuse",
      sourceExternalSessionId: "external-build-newer",
    });
    expect(externalSessionId).toBe("external-build-newer");
    expect(loadAgentSessionsCalls).toBe(1);
  });

  test("forks from the selected source session for pull request generation", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const persistedSnapshots: AgentSessionRecord[] = [];
    let sessionsById: Record<string, AgentSessionState> = {
      "external-source-build": {
        runtimeKind: "opencode",
        externalSessionId: "external-source-build",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
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
      expect(input.repoPath).toBe("/tmp/repo");
      expect(input.runtimeKind).toBe("opencode");
      expect(input.workingDirectory).toBe("/tmp/repo/worktree");
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-forked-pr-session",
        startedAt: "2026-02-22T08:20:00.000Z",
        role: "build",
        scenario: "build_pull_request_generation",
        status: "idle",
      };
    };
    adapter.loadSessionHistory = async (input) => {
      expect(input.repoPath).toBe("/tmp/repo");
      expect(input.runtimeKind).toBe("opencode");
      expect(input.workingDirectory).toBe("/tmp/repo/worktree");
      expect(input.externalSessionId).toBe("external-forked-pr-session");
      return [
        {
          messageId: "fork-user-1",
          role: "user",
          state: "read",
          timestamp: "2026-02-22T08:21:00.000Z",
          text: "Generate the PR summary.",
          displayParts: [],
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
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
      const externalSessionId = await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_pull_request_generation",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceExternalSessionId: "external-source-build",
      });

      expect(externalSessionId).toBe("external-forked-pr-session");
      expect(sessionsById["external-forked-pr-session"]?.scenario).toBe(
        "build_pull_request_generation",
      );
      expect(sessionsById["external-forked-pr-session"]?.workingDirectory).toBe(
        "/tmp/repo/worktree",
      );
      expect(
        sessionsById["external-forked-pr-session"]
          ? sessionMessagesToArray(sessionsById["external-forked-pr-session"])
          : undefined,
      ).toEqual([
        {
          id: "history:session-forked:external-forked-pr-session",
          role: "system",
          content: "Session forked (build - build_pull_request_generation)",
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "history:system-prompt:external-forked-pr-session",
          role: "system",
          content: expect.stringContaining("System prompt:"),
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "fork-user-1",
          role: "user",
          content: "Generate the PR summary.",
          timestamp: "2026-02-22T08:21:00.000Z",
          meta: {
            kind: "user",
            state: "read",
          },
        },
        {
          id: "fork-assistant-1",
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
      expect(persistedSnapshots[0]?.externalSessionId).toBe("external-forked-pr-session");
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("hydrates a stopped source session before forking so inherited history is available immediately", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const loadAgentSessionsCalls: Array<{ taskId: string; targetExternalSessionId?: string }> = [];
    let sessionsById: Record<string, AgentSessionState> = {
      "external-source-build": {
        runtimeKind: "opencode",
        externalSessionId: "external-source-build",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
        status: "stopped",
        startedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: null,
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
        state: "read",
        timestamp: "2026-02-22T08:21:00.000Z",
        text: "Hydrated child history",
        displayParts: [],
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async (taskId, options) => {
        const targetExternalSessionId = options?.targetExternalSessionId ?? undefined;
        loadAgentSessionsCalls.push(
          targetExternalSessionId ? { taskId, targetExternalSessionId } : { taskId },
        );
        const sourceBuild = sessionsById["external-source-build"];
        if (!sourceBuild) {
          throw new Error("Missing external-source-build session");
        }
        sessionsById = {
          ...sessionsById,
          "external-source-build": {
            ...sourceBuild,
            status: "idle",
            runtimeId: "runtime-1",
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
      const externalSessionId = await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_pull_request_generation",
        startMode: "fork",
        selectedModel: BUILD_SELECTION,
        sourceExternalSessionId: "external-source-build",
      });

      expect(externalSessionId).toBe("external-forked-from-hydrated-source");
      expect(loadAgentSessionsCalls).toEqual([
        {
          taskId: "task-1",
          targetExternalSessionId: "external-source-build",
        },
      ]);
      expect(
        sessionsById["external-forked-from-hydrated-source"]
          ? sessionMessagesToArray(sessionsById["external-forked-from-hydrated-source"])
          : undefined,
      ).toEqual([
        {
          id: "history:session-forked:external-forked-from-hydrated-source",
          role: "system",
          content: "Session forked (build - build_pull_request_generation)",
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "history:system-prompt:external-forked-from-hydrated-source",
          role: "system",
          content: expect.stringContaining("System prompt:"),
          timestamp: "2026-02-22T08:20:00.000Z",
        },
        {
          id: "child-user-1",
          role: "user",
          content: "Hydrated child history",
          timestamp: "2026-02-22T08:21:00.000Z",
          meta: {
            kind: "user",
            state: "read",
          },
        },
      ]);
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("forks from a hydrated source session without live runtime transport", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const forkCalls: unknown[] = [];
    let sessionsById: Record<string, AgentSessionState> = {
      "external-source-build": {
        runtimeKind: "opencode",
        externalSessionId: "external-source-build",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
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
    };

    adapter.forkSession = async (input) => {
      forkCalls.push(input);
      return {
        runtimeKind: "opencode",
        externalSessionId: "external-forked-from-runtime-connection",
        startedAt: "2026-02-22T08:20:00.000Z",
        role: "build",
        scenario: "build_pull_request_generation",
        status: "idle",
      };
    };
    adapter.loadSessionHistory = async (input) => {
      expect(input.repoPath).toBe("/tmp/repo");
      expect(input.runtimeKind).toBe("opencode");
      expect(input.workingDirectory).toBe("/tmp/repo/worktree");
      return [];
    };

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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
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
          sourceExternalSessionId: "external-source-build",
        }),
      ).resolves.toBe("external-forked-from-runtime-connection");
      expect(forkCalls).toHaveLength(1);
    } finally {
      adapter.forkSession = originalForkSession;
    }
  });

  test("fails explicitly when fork source runtime kind metadata is missing", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const forkCalls: unknown[] = [];
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-source-build": {
          externalSessionId: "external-source-build",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
          startedAt: "2026-02-22T08:10:00.000Z",
          runtimeId: null,
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
    adapter.forkSession = async (input) => {
      forkCalls.push(input);
      return {
        runtimeKind: "opencode",
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
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
          sourceExternalSessionId: "external-source-build",
        }),
      ).rejects.toThrow(
        'Session "external-source-build" is missing runtime kind metadata required for forking.',
      );
      expect(forkCalls).toHaveLength(0);
    } finally {
      adapter.forkSession = originalForkSession;
    }
  });

  test("stops the forked session when child history hydration fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const originalStopSession = adapter.stopSession;
    const stoppedSessionIds: string[] = [];
    let sessionsById: Record<string, AgentSessionState> = {
      "external-source-build": {
        runtimeKind: "opencode",
        externalSessionId: "external-source-build",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
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
      externalSessionId: "external-fork-history-failure",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      scenario: "build_pull_request_generation",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => {
      throw new Error("history unavailable");
    };
    adapter.stopSession = async (externalSessionId) => {
      stoppedSessionIds.push(externalSessionId);
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
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
          sourceExternalSessionId: "external-source-build",
        }),
      ).rejects.toThrow(
        'Failed to initialize started session "external-fork-history-failure": history unavailable. The started session was stopped before local registration.',
      );
      expect(stoppedSessionIds).toEqual(["external-fork-history-failure"]);
      expect(sessionsById["external-fork-history-failure"]).toBeUndefined();
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
      adapter.stopSession = originalStopSession;
    }
  });

  test("stops the forked session when the repo becomes stale after child history hydration", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    const originalStopSession = adapter.stopSession;
    const stoppedSessionIds: string[] = [];
    let sessionsById: Record<string, AgentSessionState> = {
      "external-source-build": {
        runtimeKind: "opencode",
        externalSessionId: "external-source-build",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
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
      externalSessionId: "external-forked-stale-after-history",
      startedAt: "2026-02-22T08:20:00.000Z",
      role: "build",
      scenario: "build_pull_request_generation",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return [
        {
          messageId: "child-user-1",
          role: "user",
          state: "read",
          timestamp: "2026-02-22T08:21:00.000Z",
          text: "Hydrated child history",
          displayParts: [],
          parts: [],
        },
      ];
    };
    adapter.stopSession = async (externalSessionId) => {
      stoppedSessionIds.push(externalSessionId);
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
      currentWorkspaceRepoPathRef,
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
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
          sourceExternalSessionId: "external-source-build",
        }),
      ).rejects.toThrow("Workspace changed while starting session.");
      expect(stoppedSessionIds).toEqual(["external-forked-stale-after-history"]);
      expect(sessionsById["external-forked-stale-after-history"]).toBeUndefined();
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
        "external-source-build": {
          runtimeKind: "opencode",
          externalSessionId: "external-source-build",
          taskId: "task-1",
          repoPath: "/tmp/repo",
          role: "build",
          scenario: "build_implementation_start",
          status: "idle",
          startedAt: "2026-02-22T08:10:00.000Z",
          runtimeId: "runtime-1",
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "claude-code",
        runtimeId: "runtime-2",
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
          sourceExternalSessionId: "external-source-build",
          selectedModel: {
            runtimeKind: "claude-code",
            providerId: "anthropic",
            modelId: "claude-sonnet-4",
            variant: "default",
            profileId: "build",
          },
        }),
      ).rejects.toThrow(
        'Session "external-source-build" cannot be forked with runtime "claude-code" because it belongs to runtime "opencode".',
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
        externalSessionId: "fresh-runtime-external",
        startedAt: "2026-02-22T08:40:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    setPersistedSessionListFixture("/tmp/repo", "task-1", [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-opencode",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
        startedAt: "2026-02-22T08:20:00.000Z",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "Ares",
        },
      }),
    ]);

    const sessionsRef = { current: {} };
    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [taskFixture] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "claude-code",
        runtimeId: "runtime-claude",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
        sessionsRef.current = {
          "external-opencode": {
            runtimeKind: "opencode",
            externalSessionId: "external-opencode",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:20:00.000Z",
            runtimeId: "runtime-1",
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
          sourceExternalSessionId: "external-opencode",
        }),
      ).resolves.toBe("external-opencode");
      expect(loadAgentSessionsCalls).toBe(1);
      expect(startCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
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
        externalSessionId: "fresh-runtime-external",
        startedAt: "2026-02-22T08:40:00.000Z",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    setPersistedSessionListFixture("/tmp/repo", "task-1", [
      {
        externalSessionId: "external-claude",
        runtimeKind: "claude-code",
        role: "build",
        scenario: "build_after_human_request_changes",
        startedAt: "2026-02-22T08:20:00.000Z",
        workingDirectory: "/tmp/repo/worktree",
        selectedModel: {
          runtimeKind: "claude-code",
          providerId: "anthropic",
          modelId: "claude-3-7-sonnet",
          profileId: "Hephaestus",
        },
      },
    ]);

    const sessionsRef = { current: {} };
    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => continuationTarget("/tmp/repo/worktree"),
      ensureRuntime: async () => ({
        kind: "claude-code",
        runtimeId: "runtime-claude",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
        sessionsRef.current = {
          "external-claude": {
            runtimeKind: "claude-code",
            externalSessionId: "external-claude",
            taskId: "task-1",
            repoPath: "/tmp/repo",
            role: "build",
            scenario: "build_after_human_request_changes",
            status: "idle",
            startedAt: "2026-02-22T08:20:00.000Z",
            runtimeId: "runtime-1",
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
      const externalSessionId = await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_after_human_request_changes",
        startMode: "reuse",
        sourceExternalSessionId: "external-claude",
      });
      expect(externalSessionId).toBe("external-claude");
      expect(loadAgentSessionsCalls).toBe(1);
      expect(startCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          kind: "opencode",
          runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => {
        qaTargetCalls += 1;
        return continuationTarget("/tmp/repo/worktree");
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      resolveTaskWorktree: async () => {
        qaTargetCalls += 1;
        return continuationTarget("/tmp/repo/worktree");
      },
      ensureRuntime: async (_repoPath, _taskId, _role, options) => {
        ensuredWorkingDirectories.push(options?.targetWorkingDirectory);
        return {
          kind: "opencode",
          runtimeId: null,
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
      ).resolves.toBe("external-qa");
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
      currentWorkspaceRepoPathRef: { current: "/tmp/other" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    let sessionsState: Record<string, AgentSessionState> = {};
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      sessionsState = typeof updater === "function" ? updater(sessionsState) : updater;
    };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => ({
      runtimeKind: "opencode",
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
      currentWorkspaceRepoPathRef,
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    let stopCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    const originalStopSession = adapter.stopSession;
    adapter.startSession = async () => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return {
        runtimeKind: "opencode",
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
      currentWorkspaceRepoPathRef,
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    let stopCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    const originalStopSession = adapter.stopSession;
    adapter.startSession = async () => {
      return {
        runtimeKind: "opencode",
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
      currentWorkspaceRepoPathRef,
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {
        currentWorkspaceRepoPathRef.current = "/tmp/other";
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    const originalStopSession = adapter.stopSession;
    adapter.startSession = async () => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return {
        runtimeKind: "opencode",
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
      currentWorkspaceRepoPathRef,
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
      await withCapturedConsole("error", async (calls) => {
        await expect(
          start({
            taskId: "task-1",
            role: "build",
            startMode: "fresh",
            selectedModel: BUILD_SELECTION,
          }),
        ).rejects.toThrow(
          "Workspace changed while starting session. Failed to stop stale started session 'external-created': stop boom",
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {
        attachCalls += 1;
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
      const externalSessionId = await start({
        taskId: "task-1",
        role: "build",
        sendKickoff: true,
        startMode: "fresh",
        selectedModel: BUILD_SELECTION,
      });
      expect(externalSessionId).toBe("external-created");
      expect(startCalls).toBe(1);
      expect(attachCalls).toBe(1);
      expect(persistCalls).toBe(1);
      expect(kickoffCalls).toBe(1);
      expect(refreshCalls).toBe(1);
      expect(Object.keys(sessionsState)).toContain("external-created");
      expect(
        sessionsState["external-created"]
          ? sessionMessageAt(sessionsState["external-created"], 0)
          : undefined,
      ).toEqual({
        id: "history:session-start:external-created",
        role: "system",
        content: "Session started (build - build_implementation_start)",
        timestamp: "2026-02-22T08:00:10.000Z",
      });
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("does not start a runtime when prompt override loading fails", async () => {
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => {
        runtimeCalls += 1;
        return {
          kind: "opencode",
          runtimeId: null,
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadTaskDocuments: async () => {
        throw new Error("prompt load failed");
      },
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => {
        throw new Error("prompt override load failed");
      },
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
      ).rejects.toThrow("prompt override load failed");
      expect(runtimeCalls).toBe(0);
    } finally {
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  for (const runtimeKind of [undefined, "", "  "] as const) {
    const caseLabel = runtimeKind === undefined ? "missing" : "blank";

    test(`does not start a fresh session when selected model runtime kind is ${caseLabel}`, async () => {
      let runtimeCalls = 0;
      let startCalls = 0;
      let persistCalls = 0;

      const adapter = new OpencodeSdkAdapter();
      const originalStartSession = adapter.startSession;
      adapter.startSession = async () => {
        startCalls += 1;
        throw new Error("startSession should not be reached");
      };

      const selectedModel = (() => {
        if (runtimeKind === undefined) {
          const { runtimeKind: _runtimeKind, ...selectionWithoutRuntime } = BUILD_SELECTION;
          return selectionWithoutRuntime as AgentModelSelection;
        }
        return { ...BUILD_SELECTION, runtimeKind } as AgentModelSelection;
      })();

      const start = createStartAgentSessionWithFlatDeps({
        activeRepo: "/tmp/repo",
        adapter,
        setSessionsById: () => {},
        sessionsRef: { current: {} },
        taskRef: { current: [taskFixture] },
        repoEpochRef: { current: 1 },
        currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
        inFlightStartsByWorkspaceTaskRef: { current: new Map() },
        attachSessionListener: () => {},
        resolveTaskWorktree: async () => ({
          workingDirectory: "/tmp/repo/worktree",
          source: "active_build_run",
        }),
        ensureRuntime: async () => {
          runtimeCalls += 1;
          return {
            kind: "opencode",
            runtimeId: null,
            workingDirectory: "/tmp/repo/worktree",
          };
        },
        loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
        loadRepoDefaultModel: async () => null,
        loadRepoPromptOverrides: async () => ({}),
        loadAgentSessions: async () => {},
        refreshTaskData: async () => {},
        persistSessionRecord: async () => {
          persistCalls += 1;
        },
        sendAgentMessage: async () => {},
      });

      try {
        await expect(
          start({
            taskId: "task-1",
            role: "build",
            startMode: "fresh",
            selectedModel,
          }),
        ).rejects.toThrow(
          "Runtime kind is required to start build sessions. Select an explicit runtime before starting a session.",
        );
        expect(runtimeCalls).toBe(0);
        expect(startCalls).toBe(0);
        expect(persistCalls).toBe(0);
      } finally {
        adapter.startSession = originalStartSession;
      }
    });
  }

  test("does not block start completion on kickoff refresh", async () => {
    const refreshDeferred = createDeferred<void>();
    let refreshCalls = 0;

    const adapter = new OpencodeSdkAdapter();
    const originalStartSession = adapter.startSession;
    adapter.startSession = async () => ({
      runtimeKind: "opencode",
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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

      expect(raceResult).toBe("external-created");
      expect(refreshCalls).toBe(1);
      await expect(startPromise).resolves.toBe("external-created");
    } finally {
      refreshDeferred.resolve();
      adapter.startSession = originalStartSession;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("includes the effective task target branch in build pull request kickoff prompts", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    adapter.forkSession = async () => ({
      runtimeKind: "opencode",
      externalSessionId: "external-created",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "build",
      scenario: "build_pull_request_generation",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => [];

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    let sessionsById: Record<string, AgentSessionState> = {
      "external-source-build": {
        runtimeKind: "opencode",
        externalSessionId: "external-source-build",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
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
    };

    let kickoffPrompt = "";
    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        sessionsById = typeof updater === "function" ? updater(sessionsById) : updater;
      },
      sessionsRef: { current: sessionsById },
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            title: "Implement feature",
            description: "desc",
            status: "in_progress",
            priority: 1,
            targetBranch: {
              remote: "upstream",
              branch: "release/2026.04",
            },
          }),
        ],
      },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadRepoDefaultTargetBranch: async () => ({ remote: "origin", branch: "main" }),
      loadAgentSessions: async () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      sendAgentMessage: async (_externalSessionId, parts) => {
        kickoffPrompt = parts.map((part) => (part.kind === "text" ? part.text : "")).join("\n");
      },
    });

    try {
      await start({
        taskId: "task-1",
        role: "build",
        scenario: "build_pull_request_generation",
        sendKickoff: true,
        startMode: "fork",
        sourceExternalSessionId: "external-source-build",
        selectedModel: BUILD_SELECTION,
      });

      expect(kickoffPrompt).toContain("targetBranch: upstream/release/2026.04");
      expect(kickoffPrompt).toContain(
        "Treat the targetBranch above as the pull-request base branch",
      );
      expect(kickoffPrompt).not.toContain("targetBranch: origin/main");
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
      host.agentSessionsList = originalAgentSessionsList;
    }
  });

  test("fails fast when build pull request kickoff would use invalid task target branch metadata", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalLoadSessionHistory = adapter.loadSessionHistory;
    adapter.forkSession = async () => ({
      runtimeKind: "opencode",
      externalSessionId: "external-created",
      startedAt: "2026-02-22T08:00:10.000Z",
      role: "build",
      scenario: "build_pull_request_generation",
      status: "idle",
    });
    adapter.loadSessionHistory = async () => [];

    const originalAgentSessionsList = host.agentSessionsList;
    host.agentSessionsList = async () => [];

    let sessionsById: Record<string, AgentSessionState> = {
      "external-source-build": {
        runtimeKind: "opencode",
        externalSessionId: "external-source-build",
        taskId: "task-1",
        repoPath: "/tmp/repo",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:10:00.000Z",
        runtimeId: "runtime-1",
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
    };

    const start = createStartAgentSessionWithFlatDeps({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        sessionsById = typeof updater === "function" ? updater(sessionsById) : updater;
      },
      sessionsRef: { current: sessionsById },
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            title: "Implement feature",
            description: "desc",
            status: "in_progress",
            priority: 1,
            targetBranchError: "Invalid openducktor.targetBranch metadata: missing field `branch`.",
          }),
        ],
      },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadRepoDefaultTargetBranch: async () => ({ remote: "origin", branch: "main" }),
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
          sendKickoff: true,
          startMode: "fork",
          sourceExternalSessionId: "external-source-build",
          selectedModel: BUILD_SELECTION,
        }),
      ).rejects.toThrow(
        'Task "task-1" has invalid target branch metadata: Invalid openducktor.targetBranch metadata: missing field `branch`.',
      );
    } finally {
      adapter.forkSession = originalForkSession;
      adapter.loadSessionHistory = originalLoadSessionHistory;
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
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
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
      ).resolves.toBe("external-created");
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
