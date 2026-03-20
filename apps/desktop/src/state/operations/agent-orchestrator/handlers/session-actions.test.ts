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
      taskRef: { current: [] },
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

  test("forkAgentSession logs todo warm-up failures instead of leaving an unhandled rejection", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    const originalError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = ((...args: unknown[]) => {
      errorCalls.push(args);
    }) as typeof console.error;

    adapter.forkSession = async () => ({
      sessionId: "session-2",
      externalSessionId: "external-2",
      startedAt: "2026-02-22T09:00:00.000Z",
      runtimeKind: "opencode",
      role: "build",
      scenario: "build_implementation_start",
      status: "idle",
    });

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "idle",
        }),
      },
    };
    const task = createTaskCardFixture({
      id: "task-1",
      issueType: "feature",
      aiReviewEnabled: true,
      status: "in_progress",
    });
    let persistedSessionId: string | null = null;

    const actions = createAgentSessionActions({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        sessionsRef.current =
          typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
      sessionsRef,
      taskRef: { current: [task] },
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
        runId: "run-1",
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
      loadSessionTodos: async () => {
        throw new Error("todo sync failed");
      },
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async (session) => {
        persistedSessionId = session.sessionId;
      },
    });

    try {
      await expect(
        actions.forkAgentSession({
          parentSessionId: "session-1",
        }),
      ).resolves.toBe("session-2");

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(persistedSessionId === "session-2").toBe(true);
      expect(errorCalls).toHaveLength(1);
      expect(errorCalls[0]?.[0]).toBe("[agent-orchestrator]");
      expect(errorCalls[0]?.[1]).toBe("fork-session-warm-session-todos");
    } finally {
      adapter.forkSession = originalForkSession;
      console.error = originalError;
    }
  });

  test("forkAgentSession aborts without side effects when the active repo becomes stale", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalForkSession = adapter.forkSession;
    let forkCalls = 0;
    let attachCalls = 0;
    let persistCalls = 0;
    let setCalls = 0;
    const promptOverridesDeferred = createDeferred<Record<string, string>>();
    const repoEpochRef = { current: 1 };
    const previousRepoRef = { current: "/tmp/repo" as string | null };

    adapter.forkSession = async () => {
      forkCalls += 1;
      return {
        sessionId: "session-2",
        externalSessionId: "external-2",
        startedAt: "2026-02-22T09:00:00.000Z",
        runtimeKind: "opencode",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          status: "idle",
        }),
      },
    };
    const task = createTaskCardFixture({
      id: "task-1",
      issueType: "feature",
      aiReviewEnabled: true,
      status: "in_progress",
    });

    const actions = createAgentSessionActions({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        setCalls += 1;
        sessionsRef.current =
          typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
      sessionsRef,
      taskRef: { current: [task] },
      repoEpochRef,
      previousRepoRef,
      inFlightStartsByRepoTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: () => {},
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
      loadRepoPromptOverrides: async () => promptOverridesDeferred.promise,
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {
        persistCalls += 1;
      },
    });

    try {
      const forkPromise = actions.forkAgentSession({
        parentSessionId: "session-1",
      });

      repoEpochRef.current = 2;
      previousRepoRef.current = "/tmp/other-repo";
      promptOverridesDeferred.resolve({});

      await expect(forkPromise).rejects.toThrow("Workspace changed while forking session.");
      expect(forkCalls).toBe(0);
      expect(setCalls).toBe(0);
      expect(attachCalls).toBe(0);
      expect(persistCalls).toBe(0);
      expect(sessionsRef.current["session-2"]).toBeUndefined();
    } finally {
      adapter.forkSession = originalForkSession;
    }
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
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
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
      adapter.hasSession = originalHasSession;
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
      expect(latest.meta.profileId).toBe("Hephaestus (Deep Agent)");
    } finally {
      adapter.hasSession = originalHasSession;
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
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {},
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
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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
        kind: "opencode",
        runtimeId: null,
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo",
      }),
      loadTaskDocuments: async () => ({ specMarkdown: "", planMarkdown: "", qaMarkdown: "" }),
      loadRepoDefaultModel: async () => null,
      loadRepoPromptOverrides: async () => ({}),
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

  test("forkAgentSession fails fast when no runtime kind is available", async () => {
    const adapter = new OpencodeSdkAdapter();
    let forkCalls = 0;
    let attachCalls = 0;
    let persistCalls = 0;
    let setCalls = 0;

    const originalForkSession = adapter.forkSession;
    adapter.forkSession = async () => {
      forkCalls += 1;
      return {
        sessionId: "session-2",
        externalSessionId: "external-2",
        startedAt: "2026-02-22T09:00:00.000Z",
        runtimeKind: "opencode",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
      };
    };

    const sessionWithoutRuntimeKind = buildSession({
      status: "idle",
    });
    delete sessionWithoutRuntimeKind.runtimeKind;
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": sessionWithoutRuntimeKind,
      },
    };
    const task = createTaskCardFixture({
      id: "task-1",
      issueType: "feature",
      aiReviewEnabled: true,
      status: "in_progress",
    });

    const actions = createAgentSessionActions({
      activeRepo: "/tmp/repo",
      adapter,
      setSessionsById: (updater) => {
        setCalls += 1;
        sessionsRef.current =
          typeof updater === "function" ? updater(sessionsRef.current) : updater;
      },
      sessionsRef,
      taskRef: { current: [task] },
      repoEpochRef: { current: 1 },
      previousRepoRef: { current: "/tmp/repo" },
      inFlightStartsByRepoTaskRef: { current: new Map() },
      unsubscribersRef: { current: new Map() },
      turnStartedAtBySessionRef: { current: {} },
      updateSession: () => {},
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
      loadSessionTodos: async () => {},
      loadSessionModelCatalog: async () => {},
      loadAgentSessions: async () => {},
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      persistSessionSnapshot: async () => {
        persistCalls += 1;
      },
    });

    try {
      await expect(
        actions.forkAgentSession({
          parentSessionId: "session-1",
        }),
      ).rejects.toThrow("Runtime kind is required to fork session 'session-1'.");
      expect(forkCalls).toBe(0);
      expect(attachCalls).toBe(0);
      expect(persistCalls).toBe(0);
      expect(setCalls).toBe(0);
    } finally {
      adapter.forkSession = originalForkSession;
    }
  });
});
