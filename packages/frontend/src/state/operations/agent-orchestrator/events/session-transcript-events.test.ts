import { describe, expect, test } from "bun:test";
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
        refreshTaskData: async () => {},
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
        refreshTaskData: async () => {},
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
        refreshTaskData: async () => {},
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
      refreshTaskData: async () => {},
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
      refreshTaskData: async () => {},
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
      refreshTaskData: async () => {},
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
});
