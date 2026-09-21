import { describe, expect, test } from "bun:test";
import {
  sessionMessagesToArray,
  lastSessionMessageForTest,
} from "@/test-utils/session-message-test-helpers";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSession,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
} from "./session-events-test-harness";

describe("agent-orchestrator session transcript events", () => {
  test("flushes deferred stream events before an immediate idle event closes the turn", async () => {
    const originalDateNow = Date.now;
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);
    let unsubscribe: (() => void) | null = null;

    try {
      unsubscribe = await listenToAgentSessionEvents({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        sessionsRef,
        updateSession,
        eventBatchWindowMs: 0,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
      });

      const handleEvent = handlers[0];
      if (!handleEvent) {
        throw new Error("Expected session event handler to be registered");
      }

      Date.now = () => 1_000;
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        part: {
          kind: "text",
          messageId: "assistant-1",
          partId: "text-1",
          text: "Visible draft",
          completed: false,
        },
      });

      Date.now = () => 1_050;
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.050Z",
        part: {
          kind: "text",
          messageId: "assistant-1",
          partId: "text-1",
          text: "Stale deferred draft",
          completed: false,
        },
      });

      handleEvent({
        type: "session_idle",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
      });

      expect(getSession(sessionsRef).status).toBe("idle");
      expect(getSessionMessages(sessionsRef).map((message) => message.content)).toEqual([
        "Stale deferred draft",
      ]);

      Date.now = () => 2_000;
      unsubscribe();
      unsubscribe = null;

      expect(getSession(sessionsRef).status).toBe("idle");
      expect(getSessionMessages(sessionsRef).map((message) => message.content)).toEqual([
        "Stale deferred draft",
      ]);
    } finally {
      unsubscribe?.();
      Date.now = originalDateNow;
    }
  });

  test("flushes completed assistant text parts ahead of throttled stale deltas", async () => {
    const originalDateNow = Date.now;
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);
    let unsubscribe: (() => void) | null = null;
    const waitForBatch = () => new Promise((resolve) => setTimeout(resolve, 10));

    try {
      unsubscribe = await listenToAgentSessionEvents({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        sessionsRef,
        updateSession,
        eventBatchWindowMs: 5,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
      });

      const handleEvent = handlers[0];
      if (!handleEvent) {
        throw new Error("Expected session event handler to be registered");
      }

      Date.now = () => 1_000;
      handleEvent({
        type: "assistant_delta",
        externalSessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Now let",
        timestamp: "2026-02-22T08:00:01.000Z",
      });
      await waitForBatch();

      expect(getSessionMessages(sessionsRef).map((message) => message.content)).toEqual([
        "Now let",
      ]);

      Date.now = () => 1_050;
      handleEvent({
        type: "assistant_delta",
        externalSessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: " me",
        timestamp: "2026-02-22T08:00:01.050Z",
      });
      await waitForBatch();

      expect(getSessionMessages(sessionsRef).map((message) => message.content)).toEqual([
        "Now let",
      ]);

      Date.now = () => 1_060;
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.060Z",
        part: {
          kind: "text",
          messageId: "assistant-1",
          partId: "text-1",
          text: "Now let me write and persist the spec.",
          completed: true,
        },
      });

      expect(getSessionMessages(sessionsRef).map((message) => message.content)).toEqual([
        "Now let me write and persist the spec.",
      ]);

      Date.now = () => 1_500;
      unsubscribe();
      unsubscribe = null;

      expect(getSessionMessages(sessionsRef).map((message) => message.content)).toEqual([
        "Now let me write and persist the spec.",
      ]);
    } finally {
      unsubscribe?.();
      Date.now = originalDateNow;
    }
  });

  test("flushes deferred final assistant messages before settling idle", async () => {
    const originalDateNow = Date.now;
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);
    let unsubscribe: (() => void) | null = null;

    try {
      unsubscribe = await listenToAgentSessionEvents({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        sessionsRef,
        updateSession,
        eventBatchWindowMs: 0,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
      });

      const handleEvent = handlers[0];
      if (!handleEvent) {
        throw new Error("Expected session event handler to be registered");
      }

      Date.now = () => 1_000;
      handleEvent({
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "First final",
      });

      Date.now = () => 1_050;
      handleEvent({
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.050Z",
        message: "Latest final",
      });

      handleEvent({
        type: "session_idle",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
      });

      expect(getSession(sessionsRef).status).toBe("idle");
      expect(getSessionMessages(sessionsRef).map((message) => message.content)).toEqual([
        "Latest final",
      ]);
      expect(getSessionMessages(sessionsRef)[0]?.meta).toMatchObject({
        kind: "assistant",
        isFinal: true,
      });
    } finally {
      unsubscribe?.();
      Date.now = originalDateNow;
    }
  });

  test("preserves consecutive final assistant messages with different ids", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      eventBatchWindowMs: 0,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "POST_IDLE_FIX_SMOKE_OK",
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-2",
      timestamp: "2026-02-22T08:00:02.000Z",
      message: "POST_IDLE_FIX_SMOKE_OK",
    });
    handleEvent({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(
      getSessionMessages(sessionsRef).filter(
        (message) => message.role === "assistant" && message.content === "POST_IDLE_FIX_SMOKE_OK",
      ),
    ).toHaveLength(2);
  });

  test("keeps same-text assistant parts and result messages distinct by id", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      eventBatchWindowMs: 0,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "user-message-1",
      timestamp: "2026-02-22T08:00:00.000Z",
      message: "Run smoke check.",
      parts: [{ kind: "text", text: "Run smoke check." }],
      state: "read",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      part: {
        kind: "text",
        messageId: "assistant-text-1",
        partId: "assistant-text-1:text",
        text: "POST_THERMOS_QUEUE_SECOND_DONE",
        completed: true,
      },
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-result-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      message: "POST_THERMOS_QUEUE_SECOND_DONE",
    });

    const assistantMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages.map((message) => message.id)).toEqual([
      "assistant-text-1",
      "assistant-result-1",
    ]);
  });

  test("finalizes a Claude assistant text part without adding a duplicate row", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([
      buildSession({ runtimeKind: "claude", status: "running" }),
    ]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      eventBatchWindowMs: 0,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      part: {
        kind: "text",
        messageId: "response-1",
        partId: "response-1:text:0",
        text: "Spec persisted.",
        completed: true,
      },
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "response-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      message: "Spec persisted.",
    });

    const assistantMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      id: "text:response-1:response-1:text:0",
      content: "Spec persisted.",
      meta: {
        kind: "assistant",
        isFinal: true,
        partId: "response-1:text:0",
        sourceMessageId: "response-1",
      },
    });
  });

  test("keeps same-text final assistant rows distinct by stable id", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      eventBatchWindowMs: 0,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "user-message-1",
      timestamp: "2026-02-22T08:00:00.000Z",
      message: "Run smoke check.",
      parts: [{ kind: "text", text: "Run smoke check." }],
      state: "read",
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-history-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "POST_THERMOS_QUEUE_SECOND_DONE",
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-result-1",
      timestamp: "2026-02-22T08:00:02.000Z",
      message: "POST_THERMOS_QUEUE_SECOND_DONE",
    });

    const assistantMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages.map((message) => message.id)).toEqual([
      "assistant-history-1",
      "assistant-result-1",
    ]);
  });

  test("deduplicates the final Claude assistant row when history arrives after the turn", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([
      buildSession({ runtimeKind: "claude", status: "running" }),
    ]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      eventBatchWindowMs: 0,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_delta",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      channel: "text",
      messageId: "response-final",
      delta: "Complete final answer",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.500Z",
      part: {
        kind: "text",
        messageId: "response-final",
        partId: "response-final:text",
        text: "Complete final answer",
        completed: true,
      },
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "response-final",
      timestamp: "2026-02-22T08:00:02.000Z",
      message: "Complete final answer",
      model: {
        providerId: "claude",
        modelId: "claude-opus-5",
        variant: "high",
        runtimeKind: "claude",
      },
    });

    const liveSession = getSession(sessionsRef);
    expect(sessionMessagesToArray(liveSession).map((message) => message.id)).toEqual([
      "text:response-final:response-final:text",
    ]);

    const loadedSession = applyLoadedSessionHistory(liveSession, [
      {
        messageId: "user-1",
        role: "user",
        state: "read",
        timestamp: "2026-02-22T08:00:00.000Z",
        text: "Run the audit.",
        displayParts: [{ kind: "text", text: "Run the audit." }],
        parts: [],
      },
      {
        messageId: "response-final",
        role: "assistant",
        timestamp: "2026-02-22T08:00:02.000Z",
        text: "Complete final answer",
        parts: [
          {
            kind: "step",
            messageId: "response-final",
            partId: "response-final:finish",
            phase: "finish",
            reason: "stop",
          },
        ],
        model: {
          providerId: "claude",
          modelId: "claude-opus-5",
          variant: "high",
          runtimeKind: "claude",
        },
      },
    ]);

    expect(sessionMessagesToArray(loadedSession).map((message) => message.id)).toEqual([
      "user-1",
      "response-final",
    ]);
    expect(lastSessionMessageForTest(loadedSession)).toMatchObject({
      id: "response-final",
      content: "Complete final answer",
      meta: expect.objectContaining({
        kind: "assistant",
        isFinal: true,
        providerId: "claude",
        modelId: "claude-opus-5",
        variant: "high",
      }),
    });
  });

  test("keeps one Claude assistant row when live events arrive after history", async () => {
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
        runtimeKind: "claude",
        status: "running",
        messages: [
          {
            id: "response-final",
            role: "assistant",
            content: "Complete final answer",
            timestamp: "2026-02-22T08:00:01.000Z",
            meta: {
              kind: "assistant",
              isFinal: true,
              providerId: "claude",
              modelId: "claude-opus-5",
              variant: "high",
              durationMs: 120_000,
            },
          },
        ],
      }),
    ]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      eventBatchWindowMs: 0,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "assistant_delta",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.500Z",
      channel: "text",
      messageId: "response-final",
      delta: "Complete final answer",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.800Z",
      part: {
        kind: "text",
        messageId: "response-final",
        partId: "response-final:text",
        text: "Complete final answer",
        completed: true,
      },
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "response-final",
      timestamp: "2026-02-22T08:00:02.000Z",
      message: "Complete final answer",
      model: {
        providerId: "claude",
        modelId: "claude-opus-5",
        variant: "high",
        runtimeKind: "claude",
      },
    });

    const assistantMessages = getSessionMessages(sessionsRef).filter(
      (message) => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      id: "text:response-final:response-final:text",
      content: "Complete final answer",
      meta: {
        kind: "assistant",
        isFinal: true,
        partId: "response-final:text",
        sourceMessageId: "response-final",
        providerId: "claude",
        modelId: "claude-opus-5",
        variant: "high",
      },
    });
  });
});
