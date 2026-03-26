import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createDeferred, createTaskCardFixture } from "../test-utils";
import { createAgentSessionActions } from "./session-actions";

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
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
  ...overrides,
});

describe("agent-orchestrator/handlers/session-actions", () => {
  test("returns action handlers", () => {
    const adapter = new OpencodeSdkAdapter();
    const actions = createAgentSessionActions({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef: { current: {} },
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: () => {},
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
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionRecord: async () => {},
    });

    expect(typeof actions.ensureSessionReady).toBe("function");
    expect(typeof actions.sendAgentMessage).toBe("function");
    expect(typeof actions.startAgentSession).toBe("function");
    expect(typeof actions.stopAgentSession).toBe("function");
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(1);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      const message = sessionsRef.current["session-1"]?.messages[0];
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [createTaskCardFixture({ id: "task-1" })] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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

  test("sends user message and appends optimistic user entry", async () => {
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      await actions.sendAgentMessage("session-1", " hello ");
      expect(sendCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.status).toBe("running");
      const latest = sessionsRef.current["session-1"]?.messages.at(-1);
      expect(latest?.role).toBe("user");
      expect(latest?.content).toBe("hello");
      if (!latest?.meta || latest.meta.kind !== "user") {
        throw new Error("Expected user message metadata");
      }
      expect(latest.meta.providerId).toBe("openai");
      expect(latest.meta.modelId).toBe("gpt-5.3-codex");
      expect(latest.meta.variant).toBe("high");
      expect(latest.meta.profileId).toBe("Hephaestus (Deep Agent)");
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      await actions.sendAgentMessage("session-1", " hello ");
      expect(sendCalls).toBe(0);
      expect(sessionsRef.current["session-1"]?.messages).toHaveLength(0);
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
      activeRepo: "/tmp/repo",
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
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      await expect(actions.sendAgentMessage("session-1", "hello")).rejects.toThrow(
        "Role 'build' is unavailable for task 'task-1' in status 'open'.",
      );
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
      activeRepo: "/tmp/repo",
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
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: () => {},
      sessionsRef,
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
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
        runtimeEndpoint: "http://127.0.0.1:4444",
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
      await actions.sendAgentMessage("session-1", "hello");
      expect(sessionsRef.current["session-1"]?.status).toBe("error");
      expect(
        sessionsRef.current["session-1"]?.messages.some((message) =>
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
});
