import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createTaskCardFixture } from "../test-utils";
import { createAgentSessionActions } from "./session-actions";

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
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
      taskRef: { current: [] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: () => {},
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
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
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
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
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

  test("keeps local stop cleanup even when remote stop throws", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalStopSession = adapter.stopSession;
    let clearCalls = 0;

    adapter.hasSession = () => true;
    adapter.stopSession = async () => {
      throw new Error("remote stop failed");
    };

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
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
    });

    try {
      await actions.stopAgentSession("session-1");
      expect(clearCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
      expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
    }
  });

  test("updates selected model and removes resolved permission", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyPermission = adapter.replyPermission;
    let replyCalls = 0;
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
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
    });

    try {
      actions.updateAgentSessionModel("session-1", {
        providerId: "openai",
        modelId: "gpt-5",
      });
      expect(sessionsRef.current["session-1"]?.selectedModel?.modelId).toBe("gpt-5");

      await actions.replyAgentPermission("session-1", "perm-1", "once");
      expect(replyCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
    } finally {
      adapter.replyPermission = originalReplyPermission;
    }
  });

  test("answers question and annotates matching tool message metadata", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyQuestion = adapter.replyQuestion;
    let replyCalls = 0;
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
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
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
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("sends user message and appends optimistic user entry", async () => {
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
          selectedModel: {
            providerId: "openai",
            modelId: "gpt-5.3-codex",
            variant: "high",
            opencodeAgent: "Hephaestus (Deep Agent)",
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
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
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
      expect(latest.meta.opencodeAgent).toBe("Hephaestus (Deep Agent)");
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
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
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
    const originalStopSession = adapter.stopSession;
    let stopCalls = 0;

    adapter.hasSession = () => true;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

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
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
    });

    try {
      await actions.stopAgentSession("session-1");
      expect(stopCalls).toBe(1);
      expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
    } finally {
      adapter.hasSession = originalHasSession;
      adapter.stopSession = originalStopSession;
    }
  });

  test("marks session as error when send fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalHasSession = adapter.hasSession;
    const originalSendUserMessage = adapter.sendUserMessage;
    let clearCalls = 0;

    adapter.hasSession = () => true;
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
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
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
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });
});
