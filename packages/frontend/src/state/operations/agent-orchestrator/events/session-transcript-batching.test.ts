import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createSessionTurnTiming } from "../support/session-turn-timing";
import {
  buildSession,
  createRecordingSessionTodosUpdater,
  createSessionsRef,
  createSessionUpdater,
  findSession,
  getSession,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
  type SessionUpdateFn,
} from "./session-events-test-harness";

describe("agent-orchestrator session transcript events", () => {
  test("flushes queued non-immediate events in a single session commit", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "starting" })]);
    const todosRecorder = createRecordingSessionTodosUpdater();
    let updateSessionCalls = 0;
    const updateSessionOptions: Array<Parameters<SessionUpdateFn>[2]> = [];

    const applySessionUpdate = createSessionUpdater(sessionsRef);
    const updateSession: SessionUpdateFn = (identity, updater, options) => {
      updateSessionCalls += 1;
      updateSessionOptions.push(options);
      return applySessionUpdate(identity, updater);
    };

    const unsubscribe = await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
      updateSession,
      updateSessionTodos: todosRecorder.updateSessionTodos,
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
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:00.000Z",
      message: "Started",
    });
    handleEvent({
      type: "session_todos_updated",
      externalSessionId: "session-1",
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
    expect(updateSessionOptions).toEqual([undefined]);
    expect(findSession(sessionsRef, "session-1")?.status).toBe("running");
    expect(getSessionMessages(sessionsRef)).toEqual([
      expect.objectContaining({ role: "system", content: "Started" }),
    ]);
    expect(todosRecorder.getTodos()).toEqual([
      {
        id: "todo-1",
        content: "Investigate live performance",
        status: "in_progress",
        priority: "high",
      },
    ]);
  });

  test("flushes queued work before applying an immediate event", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "starting" })]);
    let updateSessionCalls = 0;

    const applySessionUpdate = createSessionUpdater(sessionsRef);
    const updateSession: SessionUpdateFn = (identity, updater) => {
      updateSessionCalls += 1;
      return applySessionUpdate(identity, updater);
    };

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
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
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:00.000Z",
      message: "Started",
    });
    expect(updateSessionCalls).toBe(0);

    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
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

  test("collapses assistant stream chunks across a queued flush", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "running", role: "build" })]);
    let updateSessionCalls = 0;

    const applySessionUpdate = createSessionUpdater(sessionsRef);
    const updateSession: SessionUpdateFn = (identity, updater) => {
      updateSessionCalls += 1;
      return applySessionUpdate(identity, updater);
    };

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
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
      externalSessionId: "session-1",
      channel: "text",
      messageId: "assistant-1",
      delta: "Hello",
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    handleEvent({
      type: "assistant_delta",
      externalSessionId: "session-1",
      channel: "text",
      messageId: "assistant-1",
      delta: " world",
      timestamp: "2026-02-22T08:00:02.000Z",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
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
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:04.500Z",
      status: "running",
      message: "Still running",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
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
      externalSessionId: "session-1",
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

  test("prefers final assistant message over earlier streamed text in the same batch", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "running", role: "build" })]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
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
      externalSessionId: "session-1",
      channel: "text",
      messageId: "assistant-1",
      delta: "Draft",
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
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
      externalSessionId: "session-1",
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
      externalSessionId: "session-1",
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

  test("preserves Claude streamed tool-use draft text before final result text", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        status: "running",
        role: "spec",
        selectedModel: {
          providerId: "claude",
          modelId: "sonnet",
          runtimeKind: "claude",
        },
      }),
    ]);
    const updateSession = createSessionUpdater(sessionsRef);
    const session = getSession(sessionsRef);
    const sessionKey = agentSessionIdentityKey(session);
    const turnTiming = createSessionTurnTiming();
    turnTiming.recordTurnUserMessageTimestamp(sessionKey, "2026-02-22T08:00:00.000Z");

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
      updateSession,
      resolveTurnDurationMs: turnTiming.resolveTurnDurationMs,
      clearTurnDuration: turnTiming.clearTurnDuration,
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_delta",
      externalSessionId: "session-1",
      channel: "text",
      messageId: "claude-stream:session-1:1:1:0",
      delta: "Now let me write and persist the spec.",
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      part: {
        kind: "text",
        messageId: "claude-stream:session-1:1:1:0",
        partId: "claude-stream:session-1:1:1:0:text:0",
        text: "Now let me write and persist the spec.",
        completed: true,
      },
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.100Z",
      part: {
        kind: "tool",
        messageId: "assistant-tool-use",
        partId: "tool-1",
        callId: "tool-1",
        tool: "mcp__openducktor__odt_set_spec",
        toolType: "workflow",
        status: "running",
        input: { taskId: "task-1", markdown: "# Spec" },
        preview: '{"taskId":"task-1","markdown":"# Spec"}',
        startedAtMs: Date.parse("2026-02-22T08:00:02.100Z"),
      },
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "result-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Spec persisted and task moved to spec_ready.",
      durationMs: 2_500,
      model: {
        providerId: "claude",
        modelId: "sonnet",
        runtimeKind: "claude",
      },
    });
    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "user-1",
      timestamp: "2026-02-22T08:00:04.000Z",
      message: "Continue",
      parts: [{ kind: "text", text: "Continue" }],
      state: "read",
      model: {
        providerId: "claude",
        modelId: "sonnet",
        runtimeKind: "claude",
      },
    });

    const messages = getSessionMessages(sessionsRef);
    const draftIndex = messages.findIndex(
      (message) => message.id === "claude-stream:session-1:1:1:0",
    );
    const toolIndex = messages.findIndex(
      (message) => message.id === "tool:assistant-tool-use:tool-1",
    );
    const finalIndex = messages.findIndex((message) => message.id === "result-1");

    expect(messages[draftIndex]?.content).toBe("Now let me write and persist the spec.");
    expect(messages[draftIndex]?.meta).toMatchObject({ kind: "assistant", isFinal: false });
    expect(messages[finalIndex]?.content).toBe("Spec persisted and task moved to spec_ready.");
    expect(messages[finalIndex]?.meta).toMatchObject({
      kind: "assistant",
      isFinal: true,
      providerId: "claude",
      modelId: "sonnet",
    });
    const finalMeta = messages[finalIndex]?.meta;
    expect(finalMeta?.kind === "assistant" ? finalMeta.durationMs : undefined).toBe(2_500);
    expect(draftIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(draftIndex);
    expect(finalIndex).toBeGreaterThan(toolIndex);
  });
});
