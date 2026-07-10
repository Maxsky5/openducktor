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
  withMockedToast,
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

  test("preserves explicit history load state when live transcript changes", async () => {
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
    const sessionsRef = createSessionsRef([buildSession({ historyLoadState: "loaded" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
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
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final answer",
    });

    expect(getSession(sessionsRef).historyLoadState).toBe("loaded");
  });

  test("keeps consecutive live Codex turn durations scoped to their current turn", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_sessionRef, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([
      buildSession({ runtimeKind: "codex", status: "running" }),
    ]);
    const turnTiming = createSessionTurnTiming();

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession: createSessionUpdater(sessionsRef),
      recordTurnActivityTimestamp: turnTiming.recordTurnActivityTimestamp,
      resolveTurnDurationMs: turnTiming.resolveTurnDurationMs,
      clearTurnDuration: turnTiming.clearTurnDuration,
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }
    handleEvent({
      type: "session_status",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.800Z",
      status: { type: "busy", message: null },
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "First answer",
    });
    handleEvent({
      type: "session_status",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:14.700Z",
      status: { type: "busy", message: null },
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-2",
      timestamp: "2026-02-22T08:00:17.000Z",
      message: "Second answer",
    });

    const durations = getSessionMessages(sessionsRef)
      .filter((message) => message.meta?.kind === "assistant")
      .map((message) => (message.meta?.kind === "assistant" ? message.meta.durationMs : undefined));
    expect(durations).toEqual([1_200, 2_300]);
  });

  test("removes assistant, reasoning, and tool rows when a transcript message is retracted", async () => {
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
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            content: "stale draft",
            timestamp: "2026-02-22T08:00:01.000Z",
            meta: { kind: "assistant", isFinal: false },
          },
          {
            id: "thinking:assistant-1:thinking-1",
            role: "thinking",
            content: "stale reasoning",
            timestamp: "2026-02-22T08:00:01.000Z",
            meta: {
              kind: "reasoning",
              partId: "thinking-1",
              completed: true,
            },
          },
          {
            id: "tool:assistant-1:tool-1",
            role: "tool",
            content: "Read task",
            timestamp: "2026-02-22T08:00:01.000Z",
            meta: {
              kind: "tool",
              partId: "tool-1",
              callId: "tool-1",
              tool: "read_task",
              toolType: "workflow",
              status: "completed",
            },
          },
          {
            id: "assistant-2",
            role: "assistant",
            content: "current answer",
            timestamp: "2026-02-22T08:00:02.000Z",
            meta: { kind: "assistant", isFinal: true },
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
      refreshTaskData: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }
    handleEvent({
      type: "transcript_retracted",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      messageIds: ["assistant-1"],
    });

    expect(getSessionMessages(sessionsRef).map((message) => message.id)).toEqual(["assistant-2"]);
  });

  test("ignores observed session events after the mounted identity changes", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_sessionRef, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([
      buildSession({ workingDirectory: "/tmp/other-worktree" }),
    ]);
    let updateCount = 0;
    const applySessionUpdate = createSessionUpdater(sessionsRef);
    const updateSession: SessionUpdateFn = (identity, updater) => {
      updateCount += 1;
      return applySessionUpdate(identity, updater);
    };

    await listenToAgentSessionEvents({
      adapter,
      sessionRef: {
        externalSessionId: "session-1",
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
        runtimePolicy: { kind: "opencode" },
      },
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
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-1",
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Wrong worktree event",
    });

    expect(updateCount).toBe(0);
    expect(getSessionMessages(sessionsRef)).toEqual([]);
  });

  test("records inputReadyAtMs when tool input first becomes meaningful", async () => {
    const originalDateNow = Date.now;
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

    const sessionsRef = createSessionsRef([buildSession({ role: "planner" })]);

    const updateSession = createSessionUpdater(sessionsRef);

    try {
      await listenToAgentSessionEvents({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
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

      Date.now = () => Date.parse("2026-02-22T08:00:05.000Z");
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        part: {
          kind: "tool",
          messageId: "tool-msg-1",
          partId: "part-1",
          callId: "call-1",
          tool: "odt_set_spec",
          toolType: "generic" as const,
          status: "pending",
          input: {},
          output: "",
          error: "",
        },
      });

      const queuedMessage = getSessionMessages(sessionsRef).find(
        (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
      );
      if (queuedMessage?.meta?.kind !== "tool") {
        throw new Error("Expected queued tool message");
      }
      expect(queuedMessage.meta.inputReadyAtMs).toBeUndefined();

      Date.now = () => Date.parse("2026-02-22T08:00:10.000Z");
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:10.000Z",
        part: {
          kind: "tool",
          messageId: "tool-msg-1",
          partId: "part-1",
          callId: "call-1",
          tool: "odt_set_spec",
          toolType: "generic" as const,
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
      if (inputReadyMessage?.meta?.kind !== "tool") {
        throw new Error("Expected input-ready tool message");
      }
      expect(inputReadyMessage.meta.inputReadyAtMs).toBe(Date.parse("2026-02-22T08:00:10.000Z"));

      Date.now = () => Date.parse("2026-02-22T08:00:20.000Z");
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:20.000Z",
        part: {
          kind: "tool",
          messageId: "tool-msg-1",
          partId: "part-1",
          callId: "call-1",
          tool: "odt_set_spec",
          toolType: "generic" as const,
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
      if (completedMessage?.meta?.kind !== "tool") {
        throw new Error("Expected completed tool message");
      }
      expect(completedMessage.meta.inputReadyAtMs).toBe(Date.parse("2026-02-22T08:00:10.000Z"));
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("preserves file edit diffs across later tool updates for the same call", async () => {
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
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
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

    const fileDiffs = [
      {
        file: "/tmp/repo/src/auth.ts",
        type: "modified" as const,
        additions: 1,
        deletions: 1,
        diff: "diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
      },
    ];

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:20.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "toolu_edit_1",
        callId: "toolu_edit_1",
        tool: "Edit",
        toolType: "file_edit" as const,
        status: "completed",
        input: { file_path: "/tmp/repo/src/auth.ts" },
        output: "updated",
        fileDiffs,
      },
    });

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:21.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "toolu_edit_1",
        callId: "toolu_edit_1",
        tool: "Edit",
        toolType: "file_edit" as const,
        status: "error",
        error: "<tool_use_error>File has not been read yet.</tool_use_error>",
      },
    });

    const message = getSessionMessages(sessionsRef).find(
      (entry) => entry.meta?.kind === "tool" && entry.meta.callId === "toolu_edit_1",
    );
    if (message?.meta?.kind !== "tool") {
      throw new Error("Expected Edit tool message");
    }
    expect(message.meta.status).toBe("error");
    expect(message.meta.fileDiffs).toEqual(fileDiffs);
    expect(message.meta.input).toEqual({ file_path: "/tmp/repo/src/auth.ts" });
  });

  test("does not revive an idle session from a terminal tool update", async () => {
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
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
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
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:10.000Z",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:11.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "part-1",
        callId: "call-1",
        tool: "mcp__openducktor__odt_read_task",
        toolType: "workflow" as const,
        status: "completed",
        input: { taskId: "task-1" },
        output: "ok",
      },
    });

    expect(getSession(sessionsRef).status).toBe("idle");
    const toolMessage = getSessionMessages(sessionsRef).find(
      (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
    );
    expect(toolMessage?.meta).toMatchObject({
      kind: "tool",
      input: { taskId: "task-1" },
      output: "ok",
      status: "completed",
    });
  });

  test("inserts delayed live tool rows by transcript timestamp instead of arrival order", async () => {
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
    const sessionsRef = createSessionsRef([buildSession({ status: "running" })]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 0,
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
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "assistant-final",
      timestamp: "2026-02-22T08:00:10.000Z",
      message: "Done.",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:05.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "part-1",
        callId: "call-1",
        tool: "Read",
        toolType: "read" as const,
        status: "running",
        input: { file_path: "src/auth.ts" },
      },
    });

    expect(getSessionMessages(sessionsRef).map((message) => message.id)).toEqual([
      "tool:tool-msg-1:call-1",
      "assistant-final",
    ]);

    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:11.000Z",
      part: {
        kind: "tool",
        messageId: "tool-msg-1",
        partId: "part-1",
        callId: "call-1",
        tool: "Read",
        toolType: "read" as const,
        status: "completed",
        output: "ok",
      },
    });

    expect(getSessionMessages(sessionsRef).map((message) => message.id)).toEqual([
      "tool:tool-msg-1:call-1",
      "assistant-final",
    ]);
  });

  test("shows a toast when OpenDucktor starts MCP reconnect recovery", async () => {
    await withMockedToast(async ({ toastInfoMock }) => {
      const handlers: Array<(event: SessionEvent) => void> = [];
      const adapter: SessionEventAdapter = {
        subscribeEvents: async (_externalSessionId, handler) => {
          handlers.push(handler);
          return () => {};
        },
        replyApproval: async () => {},
      };
      const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);

      await listenToAgentSessionEvents({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        sessionsRef,
        updateSession: () => null,
        resolveTurnDurationMs: () => undefined,
        clearTurnDuration: () => {},
        refreshTaskData: async () => {},
      });

      const handleEvent = handlers[0];
      if (!handleEvent) {
        throw new Error("Expected session event handler to be registered");
      }

      handleEvent({
        type: "mcp_reconnect_started",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        serverName: "openducktor",
        workingDirectory: "/tmp/repo/.openducktor/worktrees/task-1",
        status: "failed",
        errorDetails: "MCP error -32000: Connection closed",
      });

      expect(toastInfoMock).toHaveBeenCalledWith("Reconnecting OpenDucktor MCP", {
        description:
          "OpenDucktor MCP is failed for /tmp/repo/.openducktor/worktrees/task-1. MCP error -32000: Connection closed. OpenDucktor is trying to reconnect.",
      });
      expect(getSessionMessages(sessionsRef)).toEqual([]);
    });
  });

  test("runs completion side effects once for duplicate completed tool events", async () => {
    const cases = [
      {
        name: "workflow mutation tool refresh",
        tool: "odt_set_plan",
        toolType: "workflow" as const,
        output: "ok",
        expectedRefreshTaskDataCalls: 1,
      },
      {
        name: "todo tool refresh",
        tool: "todowrite",
        toolType: "todo" as const,
        output: '{"todos":[]}',
        expectedRefreshTaskDataCalls: 0,
      },
    ] as const;

    await Promise.all(
      cases.map(async (testCase) => {
        const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
        let refreshTaskDataCalls = 0;
        const refreshTaskDataArgs: Array<[string, string | undefined]> = [];

        const adapter: SessionEventAdapter = {
          subscribeEvents: async (_externalSessionId, handler) => {
            handlers.push(
              handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
            );
            return () => {};
          },
          replyApproval: async () => {},
        };

        const sessionsRef = createSessionsRef([buildSession({ role: "build" })]);

        const updateSession = createSessionUpdater(sessionsRef);

        await listenToAgentSessionEvents({
          adapter,
          repoPath: "/tmp/repo",
          externalSessionId: "session-1",
          sessionsRef,
          updateSession,
          resolveTurnDurationMs: () => undefined,
          clearTurnDuration: () => {},
          refreshTaskData: async (repoPath, taskIdOrIds) => {
            refreshTaskDataCalls += 1;
            refreshTaskDataArgs.push([
              repoPath,
              typeof taskIdOrIds === "string" ? taskIdOrIds : undefined,
            ]);
          },
        });

        const handleEvent = handlers[0];
        if (!handleEvent) {
          throw new Error("Expected session event handler to be registered");
        }

        handleEvent({
          type: "assistant_part",
          externalSessionId: "session-1",
          timestamp: "2026-02-22T08:00:05.000Z",
          part: {
            kind: "tool",
            messageId: "tool-msg-dup",
            partId: "part-dup",
            callId: "call-dup",
            tool: testCase.tool,
            toolType: testCase.toolType,
            status: "completed",
            output: testCase.output,
            error: "",
          },
        });

        handleEvent({
          type: "assistant_part",
          externalSessionId: "session-1",
          timestamp: "2026-02-22T08:00:06.000Z",
          part: {
            kind: "tool",
            messageId: "tool-msg-dup",
            partId: "part-dup",
            callId: "call-dup",
            tool: testCase.tool,
            toolType: testCase.toolType,
            status: "completed",
            output: testCase.output,
            error: "",
          },
        });

        await Promise.resolve();

        expect(refreshTaskDataCalls).toBe(testCase.expectedRefreshTaskDataCalls);
        if (testCase.expectedRefreshTaskDataCalls > 0) {
          expect(refreshTaskDataArgs).toEqual([["/tmp/repo", "task-1"]]);
        }
      }),
    );
  });

  test("writes canonical user_message events into the transcript", async () => {
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

    const sessionsRef = createSessionsRef([buildSession()]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
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
      type: "user_message",
      externalSessionId: "session-1",
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
    const userMessage = userMessages[0];
    expect(userMessage?.id).toBe("user-message-1");
    expect(userMessage?.content).toBe("Generate the pull request");
    expect(getSession(sessionsRef).status).toBe("running");
    if (userMessage?.meta?.kind !== "user") {
      throw new Error("Expected canonical user message metadata");
    }
    expect(userMessage.meta.parts).toEqual([
      {
        kind: "text",
        text: "Generate the pull request",
      },
    ]);
    expect(userMessage.meta.providerId).toBe("openai");
    expect(userMessage.meta.modelId).toBe("gpt-5");
    expect(userMessage.meta.variant).toBe("high");
    expect(userMessage.meta.profileId).toBe("Hephaestus");
    expect(userMessage.meta.state).toBe("read");
  });

  test("preserves attachment display parts on user_message events", async () => {
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

    const sessionsRef = createSessionsRef([buildSession()]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
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
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "user-message-1",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Inspect this",
      parts: [
        { kind: "text", text: "Inspect this" },
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            kind: "image",
            mime: "image/png",
            name: "screenshot.png",
            path: "/tmp/openducktor-local-attachments/screenshot.png",
          },
        },
      ],
      state: "read",
    });

    await Promise.resolve();
    await Promise.resolve();

    const userMessage = getSessionMessages(sessionsRef).find(
      (message) => message.id === "user-message-1",
    );
    if (userMessage?.meta?.kind !== "user") {
      throw new Error("Expected canonical user message metadata");
    }
    expect(userMessage.content).toBe("Inspect this");
    expect(userMessage.meta.parts).toEqual([
      { kind: "text", text: "Inspect this" },
      {
        kind: "attachment",
        attachment: {
          id: "attachment-1",
          kind: "image",
          mime: "image/png",
          name: "screenshot.png",
          path: "/tmp/openducktor-local-attachments/screenshot.png",
        },
      },
    ]);
  });

  test("upserts session compaction notices without replacing native lifecycle state", async () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const updateSessionOptions: Array<Parameters<SessionUpdateFn>[2]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const previousMessage = {
      id: "assistant-1",
      role: "assistant" as const,
      content: "Working on it.",
      timestamp: "2026-05-18T21:00:00.000Z",
    };
    const protectedSessionState = {
      status: "running" as const,
      runtimeStatusMessage: "Runtime is still working",
      pendingUserMessageStartedAt: Date.parse("2026-05-18T21:00:00.000Z"),
      pendingApprovals: [
        {
          requestId: "approval-1",
          requestType: "command_execution" as const,
          title: "Run command",
        },
      ],
      pendingQuestions: [
        {
          requestId: "question-1",
          questions: [{ header: "Choice", question: "Proceed?", options: [] }],
        },
      ],
      todos: [
        {
          id: "todo-1",
          content: "Keep working",
          status: "in_progress" as const,
          priority: "high" as const,
        },
      ],
      contextUsage: {
        totalTokens: 12_000,
        contextWindow: 200_000,
        providerId: "openai",
        modelId: "gpt-5",
      },
      selectedModel: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "medium",
      },
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "build",
        messages: [previousMessage],
        ...protectedSessionState,
      }),
    ]);

    const applySessionUpdate = createSessionUpdater(sessionsRef);
    const updateSession: SessionUpdateFn = (identity, updater, options) => {
      updateSessionOptions.push(options);
      return applySessionUpdate(identity, updater);
    };
    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
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
      type: "session_compaction_started",
      externalSessionId: "session-1",
      timestamp: "2026-05-18T21:00:30.000Z",
      messageId: "compact-live",
      message: "Session compaction started.",
    });
    handleEvent({
      type: "session_compaction_started",
      externalSessionId: "session-1",
      timestamp: "2026-05-18T21:00:31.000Z",
      messageId: "compact-live",
      message: "Session compaction started.",
    });
    expect(getSessionMessages(sessionsRef).at(-1)).toEqual(
      expect.objectContaining({
        id: "compact-live",
        role: "system",
        content: "Session compaction started.",
        timestamp: "2026-05-18T21:00:31.000Z",
        meta: {
          kind: "session_notice",
          tone: "info",
          reason: "session_compacted",
          title: "Compacting",
          compactionStatus: "running",
        },
      }),
    );

    handleEvent({
      type: "session_compacted",
      externalSessionId: "session-1",
      timestamp: "2026-05-18T21:01:00.000Z",
      messageId: "compact-live",
      message: "Session compacted.",
    });
    handleEvent({
      type: "session_compacted",
      externalSessionId: "session-1",
      timestamp: "2026-05-18T21:01:00.000Z",
      messageId: "compact-live",
      message: "Session compacted.",
    });

    const session = findSession(sessionsRef, "session-1");
    if (!session) {
      throw new Error("Expected session to exist");
    }
    const messages = getSessionMessages(sessionsRef);
    const compactedNotice = messages.at(-1);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(previousMessage);
    expect(compactedNotice).toEqual(
      expect.objectContaining({
        id: "compact-live",
        role: "system",
        content: "Session compacted.",
        timestamp: "2026-05-18T21:01:00.000Z",
        meta: {
          kind: "session_notice",
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
          compactionStatus: "completed",
        },
      }),
    );
    expect(updateSessionOptions).toEqual([
      { persist: true },
      { persist: true },
      { persist: true },
      { persist: true },
    ]);
    expect(session).toEqual(
      expect.objectContaining({
        ...protectedSessionState,
        status: "running",
      }),
    );
  });

  test("merges queued user_message updates in place when the agent reads the turn", async () => {
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

    const sessionsRef = createSessionsRef([buildSession()]);

    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
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
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "user-message-queued",
      timestamp: "2026-02-22T08:00:01.000Z",
      message: "Queued follow-up",
      parts: [{ kind: "text", text: "Queued follow-up" }],
      state: "queued",
    });
    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
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
    const userMessage = userMessages[0];
    expect(userMessage?.content).toBe("Queued follow-up");
    if (userMessage?.meta?.kind !== "user") {
      throw new Error("Expected queued user message metadata");
    }
    expect(userMessage.meta.parts).toEqual([
      {
        kind: "text",
        text: "Queued follow-up",
      },
    ]);
    expect(userMessage.meta.state).toBe("read");
  });

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
