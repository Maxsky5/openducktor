import { describe, expect, mock, test } from "bun:test";
import {
  lastSessionMessageForTest,
  sessionMessageAt,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionEventBatcher } from "./session-event-batching";
import type { SessionEvent } from "./session-event-types";
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

const getSessionMessages = (
  sessionsRef: { current: Record<string, AgentSessionState> },
  sessionId = "session-1",
) => sessionMessagesToArray(getSession(sessionsRef, sessionId));

const getLastSessionMessage = (
  sessionsRef: { current: Record<string, AgentSessionState> },
  sessionId = "session-1",
) => lastSessionMessageForTest(getSession(sessionsRef, sessionId));

describe("agent-orchestrator-session-events", () => {
  test("centralizes assistant batch coalescing rules in one reducer", () => {
    const batcher = createSessionEventBatcher();
    const prepared = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_delta",
        sessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Hello",
        timestamp: "2026-02-22T08:00:01.000Z",
      },
      {
        type: "session_status",
        sessionId: "session-1",
        status: { type: "busy" },
        timestamp: "2026-02-22T08:00:01.500Z",
      },
      {
        type: "assistant_delta",
        sessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: " world",
        timestamp: "2026-02-22T08:00:02.000Z",
      },
      {
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
      },
      {
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
      },
      {
        type: "assistant_message",
        sessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        message: "Final answer",
      },
    ] satisfies SessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "session_status",
        sessionId: "session-1",
        status: { type: "busy" },
        timestamp: "2026-02-22T08:00:01.500Z",
      },
      {
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
      },
      {
        type: "assistant_message",
        sessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        message: "Final answer",
      },
    ]);
  });

  test("keeps per-type replacement behavior configurable inside the central reducer", () => {
    const batcher = createSessionEventBatcher();
    const prepared = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "bash",
          status: "running",
          input: { command: "pwd" },
        },
      },
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "bash",
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp/repo",
        },
      },
      {
        type: "session_todos_updated",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:03.000Z",
        todos: [{ id: "todo-1", content: "Do it", status: "pending", priority: "high" }],
      },
      {
        type: "session_todos_updated",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:04.000Z",
        todos: [{ id: "todo-1", content: "Do it", status: "completed", priority: "high" }],
      },
    ] satisfies SessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "bash",
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp/repo",
        },
      },
      {
        type: "session_todos_updated",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:04.000Z",
        todos: [{ id: "todo-1", content: "Do it", status: "completed", priority: "high" }],
      },
    ]);
  });

  test("defers repeated final assistant message snapshots within the emit gate", () => {
    let now = 1_000;
    const batcher = createSessionEventBatcher({
      nowMs: () => now,
    });
    const first = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_message",
        sessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "Final answer 1",
      },
    ] satisfies SessionEvent[]);

    now += 100;
    const second = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_message",
        sessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.100Z",
        message: "Final answer 2",
      },
    ] satisfies SessionEvent[]);

    expect(first.readyEvents).toHaveLength(1);
    expect(second.readyEvents).toHaveLength(0);
    expect(second.deferredEvents).toHaveLength(1);
  });

  test("gates assistant streaming by real elapsed time, not event timestamps", () => {
    let now = 10_000;
    const batcher = createSessionEventBatcher({
      nowMs: () => now,
    });

    const first = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        part: {
          kind: "text",
          messageId: "assistant-1",
          partId: "text-1",
          text: "Hello",
          completed: false,
        },
      },
    ] satisfies SessionEvent[]);

    now += 100;
    const second = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:20.000Z",
        part: {
          kind: "text",
          messageId: "assistant-1",
          partId: "text-1",
          text: "Hello again",
          completed: false,
        },
      },
    ] satisfies SessionEvent[]);

    expect(first.readyEvents).toHaveLength(1);
    expect(second.readyEvents).toHaveLength(0);
    expect(second.deferredEvents).toHaveLength(1);
    expect(second.nextDelayMs).toBe(400);
  });

  test("dedupes identical tool events in the central reducer", () => {
    const batcher = createSessionEventBatcher();
    const prepared = batcher.prepareQueuedSessionEvents([
      {
        type: "tool_call",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        call: {
          tool: "odt_set_spec",
          args: {
            taskId: "task-1",
            markdown: "# Spec",
          },
        },
      },
      {
        type: "tool_call",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
        call: {
          tool: "odt_set_spec",
          args: {
            taskId: "task-1",
            markdown: "# Spec",
          },
        },
      },
    ] satisfies SessionEvent[]);

    expect(prepared.readyEvents).toHaveLength(1);
    expect(prepared.readyEvents[0]?.type).toBe("tool_call");
  });

  test("records inputReadyAtMs when tool input first becomes meaningful", () => {
    const originalDateNow = Date.now;
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

    try {
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

      Date.now = () => Date.parse("2026-02-22T08:00:05.000Z");
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

      const queuedMessage = getSessionMessages(sessionsRef).find(
        (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
      );
      if (!queuedMessage || queuedMessage.meta?.kind !== "tool") {
        throw new Error("Expected queued tool message");
      }
      expect(queuedMessage.meta.inputReadyAtMs).toBeUndefined();

      Date.now = () => Date.parse("2026-02-22T08:00:10.000Z");
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

      const inputReadyMessage = getSessionMessages(sessionsRef).find(
        (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
      );
      if (!inputReadyMessage || inputReadyMessage.meta?.kind !== "tool") {
        throw new Error("Expected input-ready tool message");
      }
      expect(inputReadyMessage.meta.inputReadyAtMs).toBe(Date.parse("2026-02-22T08:00:10.000Z"));

      Date.now = () => Date.parse("2026-02-22T08:00:20.000Z");
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

      const completedMessage = getSessionMessages(sessionsRef).find(
        (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
      );
      if (!completedMessage || completedMessage.meta?.kind !== "tool") {
        throw new Error("Expected completed tool message");
      }
      expect(completedMessage.meta.inputReadyAtMs).toBe(Date.parse("2026-02-22T08:00:10.000Z"));
    } finally {
      Date.now = originalDateNow;
    }
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

  test("writes canonical user_message events into the transcript", async () => {
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

    await Promise.resolve();
    await Promise.resolve();

    const userMessages = getSessionMessages(sessionsRef).filter(
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

    const userMessages = getSessionMessages(sessionsRef).filter(
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
    expect(getSessionMessages(sessionsRef)).toHaveLength(1);
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
    expect(getSessionMessages(sessionsRef).map((message) => message.role)).toEqual([
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
    const assistantMessage = getSessionMessages(sessionsRef).find(
      (message) => message.id === "assistant-1",
    );
    expect(assistantMessage?.content).toBe("Hello world");
  });

  test("prefers final assistant message over earlier streamed text in the same batch", () => {
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
      delta: "Draft",
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    handleEvent({
      type: "assistant_part",
      sessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "text",
        messageId: "assistant-1",
        partId: "text-1",
        text: "Draft refined",
        completed: false,
      },
    });
    handleEvent({
      type: "assistant_message",
      sessionId: "session-1",
      messageId: "assistant-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final answer",
      totalTokens: 321,
      model: {
        providerId: "openai",
        modelId: "gpt-5",
      },
    });
    handleEvent({
      type: "user_message",
      sessionId: "session-1",
      messageId: "user-1",
      timestamp: "2026-02-22T08:00:04.000Z",
      message: "Continue",
      parts: [{ kind: "text", text: "Continue" }],
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
      },
    });

    const assistantMessage = getSessionMessages(sessionsRef).find(
      (message) => message.id === "assistant-1",
    );
    expect(assistantMessage?.content).toBe("Final answer");
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
      getSessionMessages(sessionsRef).some((message) =>
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
      getSessionMessages(sessionsRef).some((message) =>
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
      getSessionMessages(sessionsRef).some((message) =>
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
    const lastMessage = getLastSessionMessage(sessionsRef);
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

    const lastMessage = getLastSessionMessage(sessionsRef);
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

    const lastMessage = getLastSessionMessage(sessionsRef);
    expect(lastMessage?.content).toBe("Session stopped at your request.");
    expect(lastMessage?.meta).toEqual({
      kind: "session_notice",
      tone: "cancelled",
      reason: "user_stopped",
      title: "Stopped",
    });
    const toolMessage = getSessionMessages(sessionsRef).find(
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
      getSessionMessages(sessionsRef).some((message) => message.content.includes("Session error:")),
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

    const lastMessage = getLastSessionMessage(sessionsRef);
    expect(lastMessage?.content).toBe("Session stopped at your request.");
    expect(lastMessage?.meta).toEqual({
      kind: "session_notice",
      tone: "cancelled",
      reason: "user_stopped",
      title: "Stopped",
    });
    const toolMessage = getSessionMessages(sessionsRef).find(
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
      getSessionMessages(sessionsRef).some((message) =>
        message.content.includes("Session stopped at your request."),
      ),
    ).toBe(false);
    const lastMessage = getLastSessionMessage(sessionsRef);
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
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "assistant" && message.content.includes("Partial answer"),
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
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
    expect(getSessionMessages(sessionsRef).length).toBeGreaterThan(0);

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
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "thinking" && message.content.includes("Reasoning"),
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) => message.role === "tool" && message.meta?.kind === "tool",
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) =>
          message.role === "tool" &&
          message.meta?.kind === "tool" &&
          message.meta.tool === "odt_set_plan" &&
          message.meta.status === "error",
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) =>
          message.role === "tool" &&
          message.meta?.kind === "tool" &&
          message.meta.tool === "odt_set_spec" &&
          message.meta.status === "error",
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some((message) =>
        message.content.includes("Subtask (build): Done subtask"),
      ),
    ).toBe(true);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) =>
          message.role === "assistant" && message.content.includes("Final assistant output"),
      ),
    ).toBe(true);
    const finalAssistantMessage = getSessionMessages(sessionsRef).find(
      (message) =>
        message.role === "assistant" && message.content.includes("Final assistant output"),
    );
    if (!finalAssistantMessage || finalAssistantMessage.meta?.kind !== "assistant") {
      throw new Error("Expected final assistant message with assistant meta");
    }
    expect(finalAssistantMessage.meta.profileId).toBe("Hephaestus");
    expect(finalAssistantMessage.meta.modelId).toBe("claude-3-7-sonnet");
    expect(
      getSessionMessages(sessionsRef).some(
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

    const assistantMessages = getSessionMessages(sessionsRef).filter(
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

    expect(getSessionMessages(sessionsRef)).toHaveLength(3);
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.id).toBe("assistant-older-match");
    expect(sessionMessageAt(getSession(sessionsRef), 1)?.id).toBe("assistant-newer-miss");
    expect(sessionMessageAt(getSession(sessionsRef), 2)?.id).toBe("assistant-final");
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

  test("preserves step-derived context usage when the final assistant message omits token metadata", () => {
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
      timestamp: "2026-02-22T08:00:01.000Z",
      part: {
        kind: "text",
        messageId: "assistant-live-1",
        partId: "text-1",
        text: "Final answer",
        completed: true,
      },
    });

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

    handleEvent({
      type: "assistant_message",
      sessionId: "session-1",
      messageId: "assistant-live-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final answer",
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
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).toMatchObject({
      kind: "assistant",
      totalTokens: 35_022,
      contextWindow: 200_000,
      outputLimit: 8_192,
    });
  });

  test("preserves step-derived context usage even when no assistant transcript row exists yet", () => {
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

    handleEvent({
      type: "assistant_message",
      sessionId: "session-1",
      messageId: "assistant-live-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final answer",
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
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).toMatchObject({
      kind: "assistant",
      totalTokens: 35_022,
      contextWindow: 200_000,
      outputLimit: 8_192,
    });
  });

  test("does not carry previous-turn context usage into a new final snapshot without token updates", () => {
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
          contextUsage: {
            totalTokens: 35_022,
            contextWindow: 200_000,
            outputLimit: 8_192,
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "Hephaestus",
          },
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
      timestamp: "2026-02-22T08:00:01.000Z",
      part: {
        kind: "text",
        messageId: "assistant-live-2",
        partId: "text-1",
        text: "Fresh answer",
        completed: true,
      },
    });

    handleEvent({
      type: "assistant_message",
      sessionId: "session-1",
      messageId: "assistant-live-2",
      timestamp: "2026-02-22T08:00:02.000Z",
      message: "Fresh answer",
    });

    expect(sessionsRef.current["session-1"]?.contextUsage).toBeNull();
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).toMatchObject({
      kind: "assistant",
      agentRole: "spec",
      isFinal: true,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "Hephaestus",
    });
    expect(sessionMessageAt(getSession(sessionsRef), 0)?.meta).not.toMatchObject({
      totalTokens: 35_022,
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
      getSessionMessages(sessionsRef).some(
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
      getSessionMessages(sessionsRef).some(
        (message) => message.id === "assistant-buffered-1" && message.content === "Buffered answer",
      ),
    ).toBe(true);
    expect(sessionsRef.current["session-1"]?.draftAssistantText).toBe("");
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

    const assistantMessages = getSessionMessages(sessionsRef).filter(
      (entry) => entry.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages?.[0]?.id).toBe("msg-final");
    expect(assistantMessages?.[0]?.meta?.kind).toBe("assistant");
  });
});
