import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { attachAgentSessionListener, type SessionEventAdapter } from "./session-events";

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "http://127.0.0.1:4321",
  workingDirectory: "/tmp/repo",
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
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

describe("agent-orchestrator-session-events", () => {
  test("records inputReadyAtMs when tool input first becomes meaningful", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "planner" }),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:05.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "part-1",
        callId: "call-1",
        tool: "odt_set_spec",
        status: "pending",
        input: {},
        output: "",
        error: "",
      },
    });

    const queuedMessage = sessionsRef.current["session-1"]?.messages.find(
      (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
    );
    if (!queuedMessage || queuedMessage.meta?.kind !== "tool") {
      throw new Error("Expected queued tool message");
    }
    expect(queuedMessage.meta.inputReadyAtMs).toBeUndefined();

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:10.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "part-1",
        callId: "call-1",
        tool: "odt_set_spec",
        status: "pending",
        input: {
          taskId: "fairnest-123",
          markdown: "# Plan",
        },
        output: "",
        error: "",
      },
    });

    const inputReadyMessage = sessionsRef.current["session-1"]?.messages.find(
      (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
    );
    if (!inputReadyMessage || inputReadyMessage.meta?.kind !== "tool") {
      throw new Error("Expected input-ready tool message");
    }
    expect(inputReadyMessage.meta.inputReadyAtMs).toBe(Date.parse("2026-02-22T08:00:10.000Z"));

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:20.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "part-1",
        callId: "call-1",
        tool: "odt_set_spec",
        status: "completed",
        input: {
          taskId: "fairnest-123",
          markdown: "# Plan",
        },
        output: "ok",
        error: "",
      },
    });

    const completedMessage = sessionsRef.current["session-1"]?.messages.find(
      (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
    );
    if (!completedMessage || completedMessage.meta?.kind !== "tool") {
      throw new Error("Expected completed tool message");
    }
    expect(completedMessage.meta.inputReadyAtMs).toBe(Date.parse("2026-02-22T08:00:10.000Z"));
  });

  test("runs completion side effects once for duplicate completed tool events", async () => {
    const scenarios = [
      {
        name: "workflow mutation tool refresh",
        tool: "odt_set_plan",
        output: "ok",
        expectedRefreshTaskDataCalls: 1,
      },
      {
        name: "todo tool refresh",
        tool: "todowrite",
        output: '{"todos":[]}',
        expectedRefreshTaskDataCalls: 0,
      },
    ] as const;

    for (const scenario of scenarios) {
      const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
      let refreshTaskDataCalls = 0;
      const refreshTaskDataArgs: Array<[string, string | undefined]> = [];

      const adapter: SessionEventAdapter = {
        subscribeEvents: (_sessionId, handler) => {
          handlers.push(
            handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
          );
          return () => {};
        },
        replyPermission: async () => {},
      };

      const sessionsRef: { current: Record<string, AgentSessionState> } = {
        current: {
          "session-1": buildSession({ role: "build" }),
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
        sessionsRef.current = {
          ...sessionsRef.current,
          [sessionId]: updater(current),
        };
      };

      attachAgentSessionListener({
        adapter,
        repoPath: "/tmp/repo",
        sessionId: "session-1",
        sessionsRef,
        draftRawBySessionRef: { current: {} },
        draftSourceBySessionRef: { current: {} },
        draftMessageIdBySessionRef: { current: {} },
        draftFlushTimeoutBySessionRef: { current: {} },
        turnStartedAtBySessionRef: { current: {} },
        updateSession,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
        refreshTaskData: async (repoPath, taskId) => {
          refreshTaskDataCalls += 1;
          refreshTaskDataArgs.push([repoPath, taskId]);
        },
      });

      const handleEvent = handlers[0];
      if (!handleEvent) {
        throw new Error("Expected session event handler to be registered");
      }

      handleEvent({
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        part: {
          kind: "tool",
          messageId: "tool-msg-dup",
          partId: "part-dup",
          callId: "call-dup",
          tool: scenario.tool,
          status: "completed",
          output: scenario.output,
          error: "",
        },
      });

      handleEvent({
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:06.000Z",
        part: {
          kind: "tool",
          messageId: "tool-msg-dup",
          partId: "part-dup",
          callId: "call-dup",
          tool: scenario.tool,
          status: "completed",
          output: scenario.output,
          error: "",
        },
      });

      await Promise.resolve();

      expect(refreshTaskDataCalls).toBe(scenario.expectedRefreshTaskDataCalls);
      if (scenario.expectedRefreshTaskDataCalls > 0) {
        expect(refreshTaskDataArgs).toEqual([["/tmp/repo", "task-1"]]);
      }
    }
  });

  test("writes canonical user_message events into the transcript", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession(),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "user_message",
      sessionId: "session-1",
      messageId: "user-message-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Generate the pull request",
      parts: [{ kind: "text", text: "Generate the pull request" }],
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "Hephaestus",
      },
    });

    const userMessages = sessionsRef.current["session-1"]?.messages.filter(
      (message) => message.role === "user",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages?.[0]?.id).toBe("user-message-1");
    expect(userMessages?.[0]?.content).toBe("Generate the pull request");
    if (!userMessages?.[0]?.meta || userMessages[0].meta.kind !== "user") {
      throw new Error("Expected canonical user message metadata");
    }
    expect(userMessages[0].meta.parts).toEqual([
      {
        kind: "text",
        text: "Generate the pull request",
      },
    ]);
    expect(userMessages[0].meta.providerId).toBe("openai");
    expect(userMessages[0].meta.modelId).toBe("gpt-5");
    expect(userMessages[0].meta.variant).toBe("high");
    expect(userMessages[0].meta.profileId).toBe("Hephaestus");
    expect(userMessages[0].meta.state).toBe("read");
  });

  test("reconciles queued user_message updates in place when the agent reads the turn", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession(),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "user_message",
      sessionId: "session-1",
      messageId: "user-message-queued",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Queued follow-up",
      parts: [{ kind: "text", text: "Queued follow-up" }],
      state: "queued",
    });
    handleEvent({
      type: "user_message",
      sessionId: "session-1",
      messageId: "user-message-queued",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Queued follow-up",
      parts: [{ kind: "text", text: "Queued follow-up" }],
      state: "read",
    });

    const userMessages = sessionsRef.current["session-1"]?.messages.filter(
      (message) => message.role === "user",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages?.[0]?.content).toBe("Queued follow-up");
    if (!userMessages?.[0]?.meta || userMessages[0].meta.kind !== "user") {
      throw new Error("Expected queued user message metadata");
    }
    expect(userMessages[0].meta.parts).toEqual([
      {
        kind: "text",
        text: "Queued follow-up",
      },
    ]);
    expect(userMessages[0].meta.state).toBe("read");
  });

  test("flushes queued non-immediate events in a single session commit", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ status: "starting" }),
      },
    };
    let updateSessionCalls = 0;

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[sessionId];
      if (!current) {
        return;
      }
      updateSessionCalls += 1;
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    const unsubscribe = attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_started",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:00.000Z",
      message: "Started",
    });
    handleEvent({
      type: "session_todos_updated",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      todos: [
        {
          id: "todo-1",
          content: "Investigate live performance",
          status: "in_progress",
          priority: "high",
        },
      ],
    });

    expect(updateSessionCalls).toBe(0);

    unsubscribe();

    expect(updateSessionCalls).toBe(1);
    expect(sessionsRef.current["session-1"]?.status).toBe("running");
    expect(sessionsRef.current["session-1"]?.messages).toHaveLength(1);
    expect(sessionsRef.current["session-1"]?.todos).toEqual([
      {
        id: "todo-1",
        content: "Investigate live performance",
        status: "in_progress",
        priority: "high",
      },
    ]);
  });

  test("flushes queued work before applying an immediate event", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ status: "starting" }),
      },
    };
    let updateSessionCalls = 0;

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[sessionId];
      if (!current) {
        return;
      }
      updateSessionCalls += 1;
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_started",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:00.000Z",
      message: "Started",
    });
    expect(updateSessionCalls).toBe(0);

    handleEvent({
      type: "user_message",
      sessionId: "session-1",
      messageId: "user-message-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Continue",
      parts: [{ kind: "text", text: "Continue" }],
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
      },
    });

    expect(updateSessionCalls).toBe(2);
    expect(sessionsRef.current["session-1"]?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
  });

  test("collapses assistant stream chunks across a queued flush", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ status: "running", role: "build" }),
      },
    };
    let updateSessionCalls = 0;

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[sessionId];
      if (!current) {
        return;
      }
      updateSessionCalls += 1;
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_delta",
      sessionId: "session-1",
      channel: "text",
      messageId: "assistant-1",
      delta: "Hello",
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    handleEvent({
      type: "assistant_delta",
      sessionId: "session-1",
      channel: "text",
      messageId: "assistant-1",
      delta: " world",
      timestamp: "2026-02-22T08:00:02.000Z",
    });
    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      part: {
        kind: "reasoning",
        messageId: "assistant-1",
        partId: "reasoning-1",
        text: "Draft reasoning",
        completed: false,
      },
    });
    handleEvent({
      type: "session_status",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:04.500Z",
      status: "running",
      message: "Still running",
    });
    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:04.000Z",
      part: {
        kind: "reasoning",
        messageId: "assistant-1",
        partId: "reasoning-1",
        text: "Draft reasoning refined",
        completed: false,
      },
    });
    handleEvent({
      type: "user_message",
      sessionId: "session-1",
      messageId: "user-1",
      timestamp: "2026-02-22T08:00:05.000Z",
      message: "Continue",
      parts: [{ kind: "text", text: "Continue" }],
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
      },
    });

    expect(updateSessionCalls).toBe(2);
    const assistantMessage = sessionsRef.current["session-1"]?.messages.find(
      (message) => message.id === "assistant-1",
    );
    expect(assistantMessage?.content).toBe("Hello world");
  });

  test("auto-rejects mutating permissions for read-only roles", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const replyPermission = mock(
      (_request: Parameters<SessionEventAdapter["replyPermission"]>[0]) => Promise.resolve(),
    );
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission,
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "spec" }),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "permission_required",
      sessionId: "session-1",
      requestId: "perm-1",
      permission: "write",
      patterns: ["edit file"],
      metadata: { tool: "edit" },
      timestamp: "2026-02-22T08:00:05.000Z",
    });

    await Promise.resolve();

    expect(replyPermission).toHaveBeenCalledTimes(1);
    expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
    expect(
      sessionsRef.current["session-1"]?.messages.some((message) =>
        message.content.includes("Auto-rejected mutating permission"),
      ),
    ).toBe(true);
  });

  test("keeps permission pending when auto-reject reply fails", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const replyPermission = mock(
      (_request: Parameters<SessionEventAdapter["replyPermission"]>[0]) =>
        Promise.reject(new Error("network down")),
    );
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission,
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "spec" }),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "permission_required",
      sessionId: "session-1",
      requestId: "perm-fail",
      permission: "write",
      patterns: ["edit file"],
      metadata: { tool: "edit" },
      timestamp: "2026-02-22T08:00:05.000Z",
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(replyPermission).toHaveBeenCalledTimes(1);
    expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(1);
    expect(sessionsRef.current["session-1"]?.pendingPermissions[0]?.requestId).toBe("perm-fail");
    expect(
      sessionsRef.current["session-1"]?.messages.some((message) =>
        message.content.includes("Automatic permission rejection failed"),
      ),
    ).toBe(true);
  });

  test("keeps permission pending when auto-reject prompt rendering fails", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const replyPermission = mock(
      (_request: Parameters<SessionEventAdapter["replyPermission"]>[0]) => Promise.resolve(),
    );
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission,
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "spec",
          promptOverrides: {
            "permission.read_only.reject": {
              template: "Rejected by policy {{unsupported.token}}",
              baseVersion: 1,
            },
          },
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "permission_required",
      sessionId: "session-1",
      requestId: "perm-template-fail",
      permission: "write",
      patterns: ["edit file"],
      metadata: { tool: "edit" },
      timestamp: "2026-02-22T08:00:05.000Z",
    });

    await Promise.resolve();

    expect(replyPermission).toHaveBeenCalledTimes(0);
    expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(1);
    expect(sessionsRef.current["session-1"]?.pendingPermissions[0]?.requestId).toBe(
      "perm-template-fail",
    );
    expect(
      sessionsRef.current["session-1"]?.messages.some((message) =>
        message.content.includes("Automatic permission rejection failed"),
      ),
    ).toBe(true);
  });

  test("records session_error as an error notice and clears pending requests", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "build",
          pendingPermissions: [
            {
              requestId: "perm-1",
              permission: "read",
              patterns: ["*.md"],
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

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[sessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_error",
      sessionId: "session-1",
      message: "Aborted",
      timestamp: "2026-02-22T08:00:10.000Z",
    });

    expect(sessionsRef.current["session-1"]?.status).toBe("error");
    expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
    expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    const lastMessage = sessionsRef.current["session-1"]?.messages.at(-1);
    expect(lastMessage?.content).toBe("Aborted");
    expect(lastMessage?.meta).toEqual({
      kind: "session_notice",
      tone: "error",
      reason: "session_error",
      title: "Error",
    });
  });

  test("normalizes JSON-wrapped session_error payloads before rendering the error notice", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "build",
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_error",
      sessionId: "session-1",
      message: '{"message":"Our servers are currently overloaded. Please try again later."}',
      timestamp: "2026-02-22T08:00:10.000Z",
    });

    const lastMessage = sessionsRef.current["session-1"]?.messages.at(-1);
    expect(lastMessage?.content).toBe(
      "Our servers are currently overloaded. Please try again later.",
    );
    expect(lastMessage?.meta).toEqual({
      kind: "session_notice",
      tone: "error",
      reason: "session_error",
      title: "Error",
    });
  });

  test("renders a cancelled session notice when a user-requested stop aborts", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "build",
          stopRequestedAt: "2026-02-22T08:00:09.000Z",
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
          pendingPermissions: [
            {
              requestId: "perm-1",
              permission: "read",
              patterns: ["*.md"],
            },
          ],
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_error",
      sessionId: "session-1",
      message: '{"message":"Aborted"}',
      timestamp: "2026-02-22T08:00:10.000Z",
    });

    const lastMessage = sessionsRef.current["session-1"]?.messages.at(-1);
    expect(lastMessage?.content).toBe("Session stopped at your request.");
    expect(lastMessage?.meta).toEqual({
      kind: "session_notice",
      tone: "cancelled",
      reason: "user_stopped",
      title: "Stopped",
    });
    const toolMessage = sessionsRef.current["session-1"]?.messages.find(
      (message) => message.id === "tool-running",
    );
    expect(toolMessage?.meta?.kind).toBe("tool");
    if (toolMessage?.meta?.kind !== "tool") {
      throw new Error("Expected tool metadata");
    }
    expect(toolMessage.meta.status).toBe("error");
    expect(toolMessage.meta.error).toBe("Aborted");
    expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
    expect(sessionsRef.current["session-1"]?.stopRequestedAt).toBeNull();
    expect(
      sessionsRef.current["session-1"]?.messages.some((message) =>
        message.content.includes("Session error:"),
      ),
    ).toBe(false);
  });

  test("handles question/todo updates and terminal finish", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "question_required",
      sessionId: "session-1",
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
      timestamp: "2026-02-22T08:00:02.000Z",
    });
    handleEvent({
      type: "session_todos_updated",
      sessionId: "session-1",
      todos: [{ id: "todo-1", content: "Do it", status: "pending", priority: "high" }],
      timestamp: "2026-02-22T08:00:03.000Z",
    });
    handleEvent({
      type: "session_finished",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:04.000Z",
    });

    expect(sessionsRef.current["session-1"]?.todos).toHaveLength(1);
    expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
  });

  test("renders a cancelled session notice when a user-requested stop finishes normally", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "build",
          stopRequestedAt: "2026-02-22T08:00:09.000Z",
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
          pendingPermissions: [
            {
              requestId: "perm-1",
              permission: "read",
              patterns: ["*.md"],
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

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[sessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_finished",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:10.000Z",
      message: "Session stopped",
    });

    const lastMessage = sessionsRef.current["session-1"]?.messages.at(-1);
    expect(lastMessage?.content).toBe("Session stopped at your request.");
    expect(lastMessage?.meta).toEqual({
      kind: "session_notice",
      tone: "cancelled",
      reason: "user_stopped",
      title: "Stopped",
    });
    const toolMessage = sessionsRef.current["session-1"]?.messages.find(
      (message) => message.id === "tool-running",
    );
    expect(toolMessage?.meta?.kind).toBe("tool");
    if (toolMessage?.meta?.kind !== "tool") {
      throw new Error("Expected tool metadata");
    }
    expect(toolMessage.meta.status).toBe("error");
    expect(toolMessage.meta.error).toBe("Session stopped at your request.");
    expect(sessionsRef.current["session-1"]?.stopRequestedAt).toBeNull();
    expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
    expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
  });

  test("keeps real failures on the error path even when stop intent was set", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "build",
          stopRequestedAt: "2026-02-22T08:00:09.000Z",
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_error",
      sessionId: "session-1",
      message: "Permission denied",
      timestamp: "2026-02-22T08:00:10.000Z",
    });

    expect(sessionsRef.current["session-1"]?.status).toBe("error");
    expect(
      sessionsRef.current["session-1"]?.messages.some((message) =>
        message.content.includes("Session stopped at your request."),
      ),
    ).toBe(false);
    const lastMessage = sessionsRef.current["session-1"]?.messages.at(-1);
    expect(lastMessage?.content).toBe("Permission denied");
    expect(lastMessage?.meta).toEqual({
      kind: "session_notice",
      tone: "error",
      reason: "session_error",
      title: "Error",
    });
  });

  test("finalizes assistant draft through status transitions", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const turnStartedAtBySessionRef = { current: {} as Record<string, number> };
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef,
      updateSession,
      resolveTurnDurationMs: () => 250,
      clearTurnDuration: () => {
        turnStartedAtBySessionRef.current["session-1"] = 0;
      },
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_status",
      sessionId: "session-1",
      status: { type: "busy" },
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    handleEvent({
      type: "assistant_delta",
      sessionId: "session-1",
      channel: "text",
      messageId: "assistant-message-1",
      delta: "Partial answer",
      timestamp: "2026-02-22T08:00:02.000Z",
    });
    handleEvent({
      type: "session_status",
      sessionId: "session-1",
      status: { type: "retry", attempt: 1, message: '{"message":"Retrying"}' },
      timestamp: "2026-02-22T08:00:03.000Z",
    });
    handleEvent({
      type: "session_status",
      sessionId: "session-1",
      status: { type: "idle" },
      timestamp: "2026-02-22T08:00:04.000Z",
    });

    expect(sessionsRef.current["session-1"]?.status).toBe("idle");
    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "assistant" && message.content.includes("Partial answer"),
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "system" && message.content.includes("Retrying"),
      ),
    ).toBe(true);
  });

  test("handles session start and assistant parts matrix", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    let refreshCalls = 0;
    let clearCalls = 0;

    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build", status: "idle" }),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => 300,
      clearTurnDuration: () => {
        clearCalls += 1;
      },
      refreshTaskData: async () => {
        refreshCalls += 1;
      },
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_started",
      sessionId: "session-1",
      message: "Started",
      timestamp: "2026-02-22T08:00:01.000Z",
    });

    expect(sessionsRef.current["session-1"]?.status).toBe("running");
    expect(sessionsRef.current["session-1"]?.messages.length).toBeGreaterThan(0);

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "text",
        messageId: "m1",
        partId: "p-text",
        text: "Draft from part",
        completed: false,
      },
    });

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.100Z",
      part: {
        kind: "reasoning",
        messageId: "m1",
        partId: "p-thinking",
        text: "Reasoning...",
        completed: true,
      },
    });

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.200Z",
      part: {
        kind: "tool",
        messageId: "m1",
        partId: "p-tool",
        callId: "call-1",
        tool: "odt_build_completed",
        status: "completed",
        output: "done",
      },
    });

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.250Z",
      part: {
        kind: "tool",
        messageId: "m1",
        partId: "p-tool-fail",
        callId: "call-fail",
        tool: "odt_set_plan",
        status: "error",
        error: "Input validation error",
      },
    });

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.275Z",
      part: {
        kind: "tool",
        messageId: "m1",
        partId: "p-tool-guard",
        callId: "call-guard",
        tool: "odt_set_spec",
        status: "error",
        error: "set_spec is only allowed from open/spec_ready/ready_for_dev (current: in_progress)",
      },
    });

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.300Z",
      part: {
        kind: "subtask",
        messageId: "m1",
        partId: "p-subtask",
        agent: "build",
        prompt: "Do work",
        description: "Done subtask",
      },
    });

    handleEvent({
      type: "assistant_message",
      sessionId: "session-1",
      messageId: "m1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final assistant output",
      totalTokens: 42,
      model: {
        providerId: "anthropic",
        modelId: "claude-3-7-sonnet",
        profileId: "Hephaestus",
        variant: "max",
      },
    });

    handleEvent({
      type: "assistant_delta",
      sessionId: "session-1",
      channel: "text",
      messageId: "m2",
      timestamp: "2026-02-22T08:00:03.500Z",
      delta: "Idle follow-up",
    });

    handleEvent({
      type: "session_idle",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:04.000Z",
    });

    expect(refreshCalls).toBe(1);
    expect(clearCalls).toBeGreaterThan(0);
    expect(sessionsRef.current["session-1"]?.status).toBe("idle");
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "thinking" && message.content.includes("Reasoning"),
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "tool" && message.meta?.kind === "tool",
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) =>
          message.role === "tool" &&
          message.meta?.kind === "tool" &&
          message.meta.tool === "odt_set_plan" &&
          message.meta.status === "error",
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) =>
          message.role === "tool" &&
          message.meta?.kind === "tool" &&
          message.meta.tool === "odt_set_spec" &&
          message.meta.status === "error",
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some((message) =>
        message.content.includes("Subtask (build): Done subtask"),
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) =>
          message.role === "assistant" && message.content.includes("Final assistant output"),
      ),
    ).toBe(true);
    const finalAssistantMessage = sessionsRef.current["session-1"]?.messages.find(
      (message) =>
        message.role === "assistant" && message.content.includes("Final assistant output"),
    );
    if (!finalAssistantMessage || finalAssistantMessage.meta?.kind !== "assistant") {
      throw new Error("Expected final assistant message with assistant meta");
    }
    expect(finalAssistantMessage.meta.profileId).toBe("Hephaestus");
    expect(finalAssistantMessage.meta.modelId).toBe("claude-3-7-sonnet");
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "assistant" && message.content.includes("Idle follow-up"),
      ),
    ).toBe(true);
  });

  test("writes live text parts into transcript messages instead of draft state", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "spec",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            profileId: "Hephaestus",
          },
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "text",
        messageId: "assistant-live-1",
        partId: "part-1",
        text: "First pass",
        completed: false,
      },
    });

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.100Z",
      part: {
        kind: "text",
        messageId: "assistant-live-1",
        partId: "part-1",
        text: "First pass refined",
        completed: true,
      },
    });

    const assistantMessages = sessionsRef.current["session-1"]?.messages.filter(
      (message) => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages?.[0]?.id).toBe("assistant-live-1");
    expect(assistantMessages?.[0]?.content).toBe("First pass refined");
    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");
  });

  test("matches an older assistant message when the newest same-text message is outside the timestamp window", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          messages: [
            {
              id: "assistant-older-match",
              role: "assistant",
              content: "Stable output",
              timestamp: "2026-02-22T08:00:10.000Z",
            },
            {
              id: "assistant-newer-miss",
              role: "assistant",
              content: "Stable output",
              timestamp: "2026-02-22T08:00:20.000Z",
            },
          ],
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_message",
      sessionId: "session-1",
      messageId: "assistant-final",
      timestamp: "2026-02-22T08:00:11.000Z",
      message: "Stable output",
    });

    expect(sessionsRef.current["session-1"]?.messages).toHaveLength(2);
    expect(sessionsRef.current["session-1"]?.messages[0]?.id).toBe("assistant-final");
    expect(sessionsRef.current["session-1"]?.messages[1]?.id).toBe("assistant-newer-miss");
  });

  test("updates live session context usage from step-finish part tokens", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "spec",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "Hephaestus",
          },
          modelCatalog: {
            models: [
              {
                id: "openai/gpt-5",
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-5",
                modelName: "GPT-5",
                variants: ["high"],
                contextWindow: 200_000,
                outputLimit: 8_192,
              },
            ],
            defaultModelsByProvider: { openai: "gpt-5" },
          },
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      turnModelBySessionRef: {
        current: {
          "session-1": {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "Hephaestus",
          },
        },
      },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
      },
    });

    expect(sessionsRef.current["session-1"]?.contextUsage).toEqual({
      totalTokens: 35_022,
      contextWindow: 200_000,
      outputLimit: 8_192,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    });
  });

  test("keeps live context usage bound to the in-flight turn model after selection changes", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "anthropic",
            modelId: "claude-sonnet",
            profileId: "Hephaestus",
          },
          modelCatalog: {
            models: [
              {
                id: "openai/gpt-5",
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-5",
                modelName: "GPT-5",
                variants: ["high"],
                contextWindow: 200_000,
                outputLimit: 8_192,
              },
              {
                id: "anthropic/claude-sonnet",
                providerId: "anthropic",
                providerName: "Anthropic",
                modelId: "claude-sonnet",
                modelName: "Claude Sonnet",
                variants: [],
                contextWindow: 100_000,
                outputLimit: 4_096,
              },
            ],
            defaultModelsByProvider: { openai: "gpt-5", anthropic: "claude-sonnet" },
          },
        }),
      },
    };

    const turnModelBySessionRef = {
      current: {
        "session-1": {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "Hephaestus",
        },
      } as Record<string, AgentSessionState["selectedModel"]>,
    };

    const updateSession = (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[sessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      turnModelBySessionRef,
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "step",
        messageId: "assistant-live-1",
        partId: "step-finish-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
      },
    });

    expect(sessionsRef.current["session-1"]?.contextUsage).toEqual({
      totalTokens: 35_022,
      contextWindow: 200_000,
      outputLimit: 8_192,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    });
  });

  test("routes reasoning deltas into thinking draft state without finalizing assistant text", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build", status: "idle" }),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
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

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_delta",
      sessionId: "session-1",
      channel: "reasoning",
      messageId: "assistant-message-reasoning",
      delta: "Reason silently",
      timestamp: "2026-02-22T08:00:02.000Z",
    });

    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");
    expect(sessionsRef.current["session-1"]?.draftReasoningText).toBe("Reason silently");

    handleEvent({
      type: "session_idle",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(sessionsRef.current["session-1"]?.draftReasoningText).toBe("");
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "assistant" && message.content.includes("Reason silently"),
      ),
    ).toBe(false);
  });

  test("flushes buffered text drafts before terminal idle settlement", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build", status: "idle" }),
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => 120,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_delta",
      sessionId: "session-1",
      channel: "text",
      messageId: "assistant-buffered-1",
      delta: "Buffered answer",
      timestamp: "2026-02-22T08:00:02.000Z",
    });

    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");

    handleEvent({
      type: "session_idle",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.id === "assistant-buffered-1" && message.content === "Buffered answer",
      ),
    ).toBe(true);
  });

  test("upserts the finalized assistant message instead of appending a duplicate", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyPermission: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "spec",
          messages: [
            {
              id: "msg-final",
              role: "assistant",
              content: "Final answer",
              timestamp: "2026-02-22T08:00:03.000Z",
            },
          ],
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            profileId: "Hephaestus",
          },
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
      sessionsRef.current = {
        ...sessionsRef.current,
        [sessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      sessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => 120,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_message",
      sessionId: "session-1",
      messageId: "msg-final",
      message: "Final answer",
      timestamp: "2026-02-22T08:00:04.000Z",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "Hephaestus",
      },
    });

    const assistantMessages = sessionsRef.current["session-1"]?.messages.filter(
      (entry) => entry.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages?.[0]?.id).toBe("msg-final");
    expect(assistantMessages?.[0]?.meta?.kind).toBe("assistant");
  });
});
