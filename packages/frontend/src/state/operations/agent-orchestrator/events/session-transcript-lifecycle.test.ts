import { describe, expect, test } from "bun:test";
import { createSessionTurnTiming } from "../support/session-turn-timing";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  canResumeInterruptedTurn,
  latestTurnUsageLimit,
} from "@/lib/agent-session-interrupted-turn";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSession,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
  type SessionUpdateFn,
} from "./session-events-test-harness";

describe("agent-orchestrator session transcript events", () => {
  test("updates a limit notice with a late reset time and offers Resume only for the current turn", async () => {
    let handleEvent: ((event: SessionEvent) => void) | undefined;
    const sessionsRef = createSessionsRef([
      buildSession({
        runtimeKind: "claude",
        status: "running",
        messages: [
          {
            id: "user-1",
            role: "user",
            content: "Build",
            timestamp: "2026-10-08T00:24:00.000Z",
            meta: { kind: "user", state: "read" },
          },
        ],
      }),
    ]);
    const unsubscribe = await listenToAgentSessionEvents({
      adapter: {
        subscribeEvents: async (_id, handler) => {
          handleEvent = handler;
          return () => {};
        },
        replyApproval: async () => {},
      },
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession: createSessionUpdater(sessionsRef),
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });
    try {
      if (!handleEvent) throw new Error("Expected session event handler");
      const error: SessionEvent = {
        type: "turn_error",
        externalSessionId: "session-1",
        messageId: "limit-response",
        message: "Session limit",
        timestamp: "2026-10-08T00:24:06.000Z",
        usageLimit: {},
      };
      handleEvent(error);
      handleEvent({
        type: "session_idle",
        externalSessionId: "session-1",
        timestamp: "2026-10-08T00:24:08.000Z",
      });
      handleEvent({ ...error, usageLimit: { resetsAtEpochMs: 1791430800000 } });
      const messages = getSessionMessages(sessionsRef);
      expect(messages.filter((message) => message.id === "limit-response")).toHaveLength(1);
      expect(latestTurnUsageLimit(messages)).toEqual({ resetsAtEpochMs: 1791430800000 });
      expect(
        canResumeInterruptedTurn({
          activityState: "idle",
          messages,
          runtimeDescriptor: CLAUDE_RUNTIME_DESCRIPTOR,
        }),
      ).toBe(true);
      handleEvent({
        type: "turn_error",
        externalSessionId: "session-1",
        messageId: "later-error",
        message: "Server error",
        timestamp: "2026-10-08T00:24:09.000Z",
      });
      expect(latestTurnUsageLimit(getSessionMessages(sessionsRef))).toBeUndefined();
      handleEvent({
        type: "user_message",
        externalSessionId: "session-1",
        messageId: "user-2",
        message: "Start new work",
        parts: [],
        state: "read",
        timestamp: "2026-10-08T00:25:00.000Z",
      });
      expect(latestTurnUsageLimit(getSessionMessages(sessionsRef))).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });

  test("preserves explicit history load state when live transcript changes", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
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
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_sessionRef, handler) => {
        handlers.push(handler);
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
});
