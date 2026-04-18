import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  findSessionMessageForTest,
  lastSessionMessageForTest,
  sessionMessageAt,
  sessionMessagesToArray,
  someSessionMessageForTest,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { attachAgentSessionListener } from "../events/session-events";
import { createDeferred, createTaskCardFixture } from "../test-utils";
import { createAgentSessionActions } from "./session-actions";

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: overrides.repoPath ?? "/tmp/repo",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeId: null,
  runId: "run-1",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
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
  ...overrides,
});

const getSession = (
  sessionsRef: { current: Record<string, AgentSessionState> },
  sessionId = "session-1",
): AgentSessionState => {
  const session = sessionsRef.current[sessionId];
  if (!session) {
    throw new Error(`Expected session ${sessionId}`);
  }
  return session;
};

describe("agent-orchestrator/handlers/session-actions", () => {
  test("returns action handlers", () => {
    const adapter = new OpencodeSdkAdapter();
    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: () => {},
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    expect(typeof actions.ensureSessionReady).toBe("function");
    expect(typeof actions.sendAgentMessage).toBe("function");
    expect(typeof actions.startAgentSession).toBe("function");
    expect(typeof actions.stopAgentSession).toBe("function");
  });

  test("uses live workspace refs for session start stale checks", async () => {
    const adapter = new OpencodeSdkAdapter();
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef,
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: () => {},
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    currentWorkspaceRepoPathRef.current = "/tmp/other";

    await expect(
      actions.startAgentSession({
        taskId: "task-1",
        role: "build",
        scenario: "build_implementation_start",
        startMode: "fresh",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.4",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
      }),
    ).rejects.toThrow("Workspace changed while starting session.");
  });

  test("stops known session and clears pending state", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    adapter.hasSession = () => false;

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "planner",
          runId: null,
          runtimeId: null,
          pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: ["*"] }],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [
                {
                  header: "Confirm",
                  question: "Confirm",
                  options: [],
                  multiple: false,
                  custom: false,
                },
              ],
            },
          ],
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.stopAgentSession("session-1");
      expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    } finally {
      adapter.hasSession = originalHasSession;
    }
  });

  test("keeps session active when authoritative build stop fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    let localStopCalls = 0;
    adapter.hasSession = () => true;
    adapter.stopSession = async () => {
      localStopCalls += 1;
    };
    let clearCalls = 0;
    let unsubscribeCalls = 0;

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: ["*"] }],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [
                {
                  header: "Confirm",
                  question: "Confirm",
                  options: [],
                  multiple: false,
                  custom: false,
                },
              ],
            },
          ],
        }),
      },
    };

    const stopBuildRun = async () => {
      throw new Error("build stop failed");
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: {
        current: new Map([
          [
            "session-1",
            () => {
              unsubscribeCalls += 1;
            },
          ],
        ]),
      },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      stopBuildRun,
    });

    try {
      await expect(actions.stopAgentSession("session-1")).rejects.toThrow(
        "Failed to stop build session 'session-1': build stop failed",
      );
      expect(clearCalls).toBe(0);
      expect(localStopCalls).toBe(0);
      expect(unsubscribeCalls).toBe(0);
      expect(sessionsRef.current["session-1"]?.status).toBe("running");
      expect(sessionsRef.current["session-1"]?.stopRequestedAt).toBeNull();
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(1);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
    }
  });

  test("records stop intent before awaiting authoritative build stop", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const stopDeferred = createDeferred<void>();

    adapter.hasSession = () => false;

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "build",
          runId: "run-1",
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      stopBuildRun: async () => {
        await stopDeferred.promise;
      },
    });

    try {
      const stopPromise = actions.stopAgentSession("session-1");
      await Promise.resolve();

      expect(sessionsRef.current["session-1"]?.stopRequestedAt).toBeString();
      expect(sessionsRef.current["session-1"]?.status).toBe("running");

      stopDeferred.resolve();
      await stopPromise;

      expect(sessionsRef.current["session-1"]?.stopRequestedAt).toBeNull();
      expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
    } finally {
      adapter.hasSession = originalHasSession;
    }
  });

  test("preserves the user-stopped notice when local stop emits session_finished", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalSubscribeEvents = adapter.subscribeEvents;
    const originalStopSession = adapter.stopSession;
    let sessionEventListener: ((event: { type: string; [key: string]: unknown }) => void) | null =
      null;

    adapter.hasSession = () => true;
    adapter.subscribeEvents = (_sessionId, listener) => {
      sessionEventListener = listener as (event: { type: string; [key: string]: unknown }) => void;
      return () => {
        sessionEventListener = null;
      };
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "build",
          runId: null,
          messages: [
            {
              id: "tool-running",
              role: "tool",
              content: "Tool todowrite running...",
              timestamp: "2026-02-22T08:00:08.000Z",
              meta: {
                kind: "tool",
                partId: "part-tool-running",
                callId: "call-tool-running",
                tool: "todowrite",
                status: "running",
              },
            },
          ],
          pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: ["*"] }],
        }),
      },
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[sessionId];
      if (!current) {
        return;
      }
      sessionsRef.current[sessionId] = updater(current);
    };

    const unsubscribe = attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    adapter.stopSession = async (sessionId) => {
      sessionEventListener?.({
        type: "session_finished",
        sessionId,
        timestamp: "2026-02-22T08:00:10.000Z",
        message: "Session stopped",
      });
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map([["session-1", unsubscribe]]) },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      attachSessionListener: () => unsubscribe,
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.stopAgentSession("session-1");

      const lastMessage = lastSessionMessageForTest(getSession(sessionsRef));
      expect(lastMessage?.content).toBe("Session stopped at your request.");
      expect(lastMessage?.meta).toEqual({
        kind: "session_notice",
        tone: "cancelled",
        reason: "user_stopped",
        title: "Stopped",
      });
      const toolMessage = findSessionMessageForTest(
        getSession(sessionsRef),
        (message) => message.id === "tool-running",
      );
      expect(toolMessage?.meta?.kind).toBe("tool");
      if (toolMessage?.meta?.kind !== "tool") {
        throw new Error("Expected tool metadata");
      }
      expect(toolMessage.meta.status).toBe("error");
      expect(toolMessage.meta.error).toBe("Session stopped at your request.");
      expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
      expect(sessionsRef.current["session-1"]?.stopRequestedAt).toBeNull();
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.subscribeEvents = originalSubscribeEvents;
      adapter.stopSession = originalStopSession;
      unsubscribe();
    }
  });

  test("continues cleanup when local adapter stop fails after host stop", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    const callOrder: string[] = [];
    adapter.hasSession = () => true;
    adapter.stopSession = async () => {
      callOrder.push("local-stop");
      throw new Error("local stop failed");
    };

    let clearCalls = 0;
    let unsubscribeCalls = 0;

    const unsubscribersRef = {
      current: new Map<string, () => void>([
        [
          "session-1",
          () => {
            unsubscribeCalls += 1;
          },
        ],
      ]),
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession(),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef,
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      stopBuildRun: async () => {
        callOrder.push("host-stop");
      },
    });

    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      await expect(actions.stopAgentSession("session-1")).resolves.toBeUndefined();
      expect(callOrder).toEqual(["host-stop", "local-stop"]);
      expect(clearCalls).toBe(1);
      expect(unsubscribeCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
      console.warn = originalWarn;
    }
  });

  test("does not stop shared runtime when build/qa session lacks runId", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    adapter.hasSession = () => true;
    let buildStopCalls = 0;
    let localStopCalls = 0;

    adapter.stopSession = async () => {
      localStopCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "qa",
          runId: null,
          runtimeId: "runtime-1",
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      stopBuildRun: async () => {
        buildStopCalls += 1;
      },
    });

    try {
      await actions.stopAgentSession("session-1");
      expect(buildStopCalls).toBe(0);
      expect(localStopCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
    }
  });

  test("persists stopped snapshot before reloading host sessions", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    adapter.hasSession = () => false;

    const persistDeferred = createDeferred<void>();
    const callOrder: string[] = [];

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          runId: "run-1",
          pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: ["*"] }],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [
                {
                  header: "Proceed",
                  question: "Proceed?",
                  options: [],
                  multiple: false,
                  custom: false,
                },
              ],
            },
          ],
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {
        callOrder.push("load-agent-sessions");
      },
      clearTurnDuration: () => {},
      refreshTaskData: async () => {
        callOrder.push("refresh-task-data");
      },
      persistSessionRecord: async () => {
        callOrder.push("persist-start");
        await persistDeferred.promise;
        callOrder.push("persist-end");
      },
      stopBuildRun: async () => {
        callOrder.push("stop-build-run");
      },
      invalidateSessionStopQueries: async () => {
        callOrder.push("invalidate-stop-queries");
      },
    });

    try {
      const stopPromise = actions.stopAgentSession("session-1");
      await Promise.resolve();

      expect(callOrder).toEqual(["stop-build-run", "persist-start"]);

      persistDeferred.resolve();
      await stopPromise;

      const persistEndIndex = callOrder.indexOf("persist-end");
      expect(persistEndIndex).toBeGreaterThan(-1);
      expect(callOrder.indexOf("invalidate-stop-queries")).toBeGreaterThan(persistEndIndex);
      expect(callOrder.indexOf("refresh-task-data")).toBeGreaterThan(persistEndIndex);
      expect(callOrder.indexOf("load-agent-sessions")).toBeGreaterThan(persistEndIndex);
      expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    } finally {
      adapter.hasSession = originalHasSession;
    }
  });

  test("refreshes backend-owned state after successful host stop", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    adapter.hasSession = () => true;
    let refreshTaskDataCalls = 0;
    let loadAgentSessionsCalls = 0;
    let localStopCalls = 0;
    const invalidationCalls: Array<{ repoPath: string; taskId: string; runtimeKind?: string }> = [];

    adapter.stopSession = async () => {
      localStopCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          runtimeKind: "opencode",
          runId: "run-1",
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {
        loadAgentSessionsCalls += 1;
      },
      clearTurnDuration: () => {},
      refreshTaskData: async () => {
        refreshTaskDataCalls += 1;
      },
      persistSessionRecord: async () => {},
      stopBuildRun: async () => {},
      invalidateSessionStopQueries: async (input) => {
        invalidationCalls.push(input);
      },
    });

    try {
      await actions.stopAgentSession("session-1");
      expect(localStopCalls).toBe(1);
      expect(refreshTaskDataCalls).toBe(1);
      expect(loadAgentSessionsCalls).toBe(1);
      expect(invalidationCalls).toEqual([
        {
          repoPath: "/tmp/repo",
          taskId: "task-1",
          runtimeKind: "opencode",
        },
      ]);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
    }
  });

  test("updates selected model and removes resolved permission", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const originalReplyPermission = adapter.replyPermission;
    let replyCalls = 0;
    adapter.hasSession = () => true;
    adapter.updateSessionModel = () => {};
    adapter.replyPermission = async () => {
      replyCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: ["*"] }],
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      actions.updateAgentSessionModel("session-1", {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      });
      expect(sessionsRef.current["session-1"]?.selectedModel?.modelId).toBe("gpt-5");

      await actions.replyAgentPermission("session-1", "perm-1", "once");
      expect(replyCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.updateSessionModel = originalUpdateSessionModel;
      adapter.replyPermission = originalReplyPermission;
    }
  });

  test("replies to permission after resuming a session with pending live input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    const originalResumeSession = adapter.resumeSession;
    const originalReplyPermission = adapter.replyPermission;
    let resumeCalls = 0;
    let replyCalls = 0;
    adapter.hasSession = () => false;
    adapter.listLiveAgentSessionSnapshots = async () => [
      {
        externalSessionId: "external-session-1",
        title: "Build",
        workingDirectory: "/tmp/repo",
        startedAt: "2026-02-22T08:00:00.000Z",
        status: { type: "idle" },
        pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: [".env"] }],
        pendingQuestions: [],
      },
    ];
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        sessionId: input.sessionId,
        externalSessionId: input.externalSessionId,
        role: input.role,
        scenario: input.scenario,
        startedAt: "2026-02-22T08:00:00.000Z",
        status: "idle",
        runtimeKind: input.runtimeKind,
      };
    };
    adapter.replyPermission = async () => {
      replyCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "stopped",
          externalSessionId: "external-session-1",
          pendingPermissions: [{ requestId: "perm-1", permission: "read", patterns: [".env"] }],
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.replyAgentPermission("session-1", "perm-1", "once");
      expect(resumeCalls).toBe(1);
      expect(replyCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toEqual([]);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
      adapter.resumeSession = originalResumeSession;
      adapter.replyPermission = originalReplyPermission;
    }
  });

  test("answers question and annotates matching tool message metadata", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalReplyQuestion = adapter.replyQuestion;
    let replyCalls = 0;
    adapter.hasSession = () => true;
    adapter.replyQuestion = async () => {
      replyCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          messages: [
            {
              id: "tool-1",
              role: "tool",
              content: "Question requested",
              timestamp: "2026-02-22T08:00:01.000Z",
              meta: {
                kind: "tool",
                partId: "part-1",
                callId: "call-1",
                tool: "question",
                status: "completed",
                metadata: {},
              },
            },
          ],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [
                {
                  header: "Confirm",
                  question: "Confirm",
                  options: [],
                  multiple: false,
                  custom: false,
                },
              ],
            },
          ],
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.answerAgentQuestion("session-1", "question-1", [["yes"]]);
      expect(replyCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
      const message = sessionMessageAt(getSession(sessionsRef), 0);
      if (!message || message.meta?.kind !== "tool") {
        throw new Error("Expected tool message metadata");
      }
      expect(message.meta.metadata?.requestId).toBe("question-1");
      expect(message.meta.metadata?.answers).toEqual([["yes"]]);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("answers question after resuming a session with pending live input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    const originalResumeSession = adapter.resumeSession;
    const originalReplyQuestion = adapter.replyQuestion;
    let resumeCalls = 0;
    let replyCalls = 0;
    adapter.hasSession = () => false;
    adapter.listLiveAgentSessionSnapshots = async () => [
      {
        externalSessionId: "external-session-1",
        title: "Build",
        workingDirectory: "/tmp/repo",
        startedAt: "2026-02-22T08:00:00.000Z",
        status: { type: "idle" },
        pendingPermissions: [],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ header: "Confirm", question: "Confirm", options: [], custom: false }],
          },
        ],
      },
    ];
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        sessionId: input.sessionId,
        externalSessionId: input.externalSessionId,
        role: input.role,
        scenario: input.scenario,
        startedAt: "2026-02-22T08:00:00.000Z",
        status: "idle",
        runtimeKind: input.runtimeKind,
      };
    };
    adapter.replyQuestion = async () => {
      replyCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "stopped",
          externalSessionId: "external-session-1",
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [
                {
                  header: "Confirm",
                  question: "Confirm",
                  options: [],
                  multiple: false,
                  custom: false,
                },
              ],
            },
          ],
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.answerAgentQuestion("session-1", "question-1", [["yes"]]);
      expect(resumeCalls).toBe(1);
      expect(replyCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toEqual([]);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
      adapter.resumeSession = originalResumeSession;
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("sends user message without mutating the transcript optimistically", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.hasSession = () => true;
    adapter.listLiveAgentSessionSnapshots = async () => [];
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "idle",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5.3-codex",
            variant: "high",
            profileId: "Hephaestus (Deep Agent)",
          },
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.sendAgentMessage("session-1", [{ kind: "text", text: " hello " }]);
      expect(sendCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.status).toBe("running");
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not hydrate requested history before sending to an attached session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    const callOrder: string[] = [];

    adapter.hasSession = () => true;
    adapter.listLiveAgentSessionSnapshots = async () => [];
    adapter.sendUserMessage = async () => {
      callOrder.push("send");
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "idle",
          historyHydrationState: "not_requested",
          messages: [],
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {
        callOrder.push("hydrate");
      },
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.sendAgentMessage("session-1", [{ kind: "text", text: "hello" }]);

      expect(callOrder).toEqual(["send"]);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
      expect(sessionsRef.current["session-1"]?.historyHydrationState).toBe("not_requested");
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not send a free-form message if ensure-ready reveals pending input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;

    adapter.hasSession = () => true;
    adapter.listLiveAgentSessionSnapshots = async () => [
      {
        externalSessionId: "external-1",
        status: { type: "idle" },
        title: "Session 1",
        model: null,
        workingDirectory: "/tmp/repo/worktree",
        startedAt: "2026-02-22T08:00:00.000Z",
        pendingPermissions: [],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ header: "Confirm", question: "Confirm", options: [] }],
          },
        ],
      },
    ];
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "idle",
          historyHydrationState: "not_requested",
          messages: [],
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await expect(
        actions.sendAgentMessage("session-1", [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("Session is waiting for pending runtime input.");

      expect(sendCalls).toBe(0);
      expect(sessionsRef.current["session-1"]?.status).toBe("idle");
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not send free-form messages while waiting for pending input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;

    adapter.hasSession = () => true;
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "idle",
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [{ header: "Confirm", question: "Confirm", options: [] }],
            },
          ],
        }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.sendAgentMessage("session-1", [{ kind: "text", text: " hello " }]);
      expect(sendCalls).toBe(0);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("rejects send when role is unavailable for the current task", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;

    adapter.hasSession = () => true;
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ status: "idle", role: "build", taskId: "task-1" }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
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
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await expect(
        actions.sendAgentMessage("session-1", [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
      expect(sendCalls).toBe(0);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("allows stopping a running session even when role is unavailable", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    let stopCalls = 0;

    adapter.hasSession = () => false;

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ status: "running", role: "build", taskId: "task-1" }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
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
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
      stopBuildRun: async () => {
        stopCalls += 1;
      },
    });

    try {
      await actions.stopAgentSession("session-1");
      expect(stopCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
    } finally {
      adapter.hasSession = originalHasSession;
    }
  });

  test("marks session as error when send fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    let clearCalls = 0;

    adapter.hasSession = () => true;
    adapter.listLiveAgentSessionSnapshots = async () => [];
    adapter.sendUserMessage = async () => {
      throw new Error("send failed");
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ status: "idle" }),
      },
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.sendAgentMessage("session-1", [{ kind: "text", text: "hello" }]);
      expect(sessionsRef.current["session-1"]?.status).toBe("error");
      expect(
        someSessionMessageForTest(getSession(sessionsRef), (message) =>
          message.content.includes("Failed to send message:"),
        ),
      ).toBe(true);
      expect(clearCalls).toBe(1);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("preserves active turn drafts and timing for busy queued sends", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    const sendCalls: Array<{ sessionId: string; parts: { kind: string; text?: string }[] }> = [];

    adapter.hasSession = () => true;
    adapter.listLiveAgentSessionSnapshots = async () => [];
    adapter.sendUserMessage = async (input) => {
      sendCalls.push({
        sessionId: input.sessionId,
        parts: input.parts.map((part) =>
          part.kind === "text" ? { kind: part.kind, text: part.text } : { kind: part.kind },
        ),
      });
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "running",
          draftAssistantText: "Still working",
          draftAssistantMessageId: "assistant-live-1",
          draftReasoningText: "Thinking",
          draftReasoningMessageId: "reasoning-live-1",
        }),
      },
    };
    const turnStartedAtBySessionRef = { current: { "session-1": 1234 } };
    const turnModelBySessionRef = {
      current: {
        "session-1": {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
      } as Record<string, AgentSessionState["selectedModel"]>,
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef,
      turnModelBySessionRef,
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {
        throw new Error("busy queued send should not clear turn timing");
      },
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.sendAgentMessage("session-1", [{ kind: "text", text: "queued follow-up" }]);

      expect(sendCalls).toEqual([
        { sessionId: "session-1", parts: [{ kind: "text", text: "queued follow-up" }] },
      ]);
      expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("Still working");
      expect(sessionsRef.current["session-1"]?.draftAssistantMessageId).toBe("assistant-live-1");
      expect(sessionsRef.current["session-1"]?.draftReasoningText).toBe("Thinking");
      expect(sessionsRef.current["session-1"]?.draftReasoningMessageId).toBe("reasoning-live-1");
      expect(turnStartedAtBySessionRef.current["session-1"]).toBe(1234);
      expect(turnModelBySessionRef.current["session-1"]?.modelId).toBe("gpt-5");
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("keeps the active turn running when a busy queued send fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalListLiveAgentSessionSnapshots = adapter.listLiveAgentSessionSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    let clearCalls = 0;

    adapter.hasSession = () => true;
    adapter.listLiveAgentSessionSnapshots = async () => [];
    adapter.sendUserMessage = async () => {
      throw new Error("queued send failed");
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "running",
          draftAssistantText: "Still working",
          draftAssistantMessageId: "assistant-live-1",
          draftReasoningText: "Thinking",
          draftReasoningMessageId: "reasoning-live-1",
        }),
      },
    };
    const turnStartedAtBySessionRef = { current: { "session-1": 1234 } };
    const turnModelBySessionRef = {
      current: {
        "session-1": {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
      } as Record<string, AgentSessionState["selectedModel"]>,
    };

    const actions = createAgentSessionActions({
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      inFlightStartsByWorkspaceTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map([["session-1", () => {}]]) },
      turnStartedAtBySessionRef,
      turnModelBySessionRef,
      updateSession: (sessionId, updater) => {
        const current = sessionsRef.current[sessionId];
        if (!current) {
          return;
        }
        sessionsRef.current[sessionId] = updater(current);
      },
      attachSessionListener: () => {},
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    try {
      await actions.sendAgentMessage("session-1", [{ kind: "text", text: "queued follow-up" }]);

      expect(sessionsRef.current["session-1"]?.status).toBe("running");
      expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("Still working");
      expect(sessionsRef.current["session-1"]?.draftReasoningText).toBe("Thinking");
      expect(
        someSessionMessageForTest(getSession(sessionsRef), (message) =>
          message.content.includes("Failed to send message:"),
        ),
      ).toBe(true);
      expect(clearCalls).toBe(0);
      expect(turnStartedAtBySessionRef.current["session-1"]).toBe(1234);
      expect(turnModelBySessionRef.current["session-1"]?.modelId).toBe("gpt-5");
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.listLiveAgentSessionSnapshots = originalListLiveAgentSessionSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });
});
