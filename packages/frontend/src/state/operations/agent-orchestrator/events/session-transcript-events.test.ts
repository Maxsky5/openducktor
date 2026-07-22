import { describe, expect, test } from "bun:test";
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

  test("writes completed workflow tools into the transcript", async () => {
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

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession: createSessionUpdater(sessionsRef),
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    for (const [tool, callId] of [
      ["odt_set_spec", "call-spec"],
      ["odt_set_plan", "call-plan"],
    ]) {
      handleEvent({
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        part: {
          kind: "tool",
          messageId: `tool-msg-${callId}`,
          partId: `part-${callId}`,
          callId,
          tool,
          toolType: "workflow",
          status: "completed",
          output: "ok",
          error: "",
        },
      });
    }

    expect(
      getSessionMessages(sessionsRef)
        .filter((message) => message.meta?.kind === "tool")
        .map((message) =>
          message.meta?.kind === "tool" ? [message.meta.tool, message.meta.status] : null,
        ),
    ).toEqual([
      ["odt_set_spec", "completed"],
      ["odt_set_plan", "completed"],
    ]);
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
      selectedModel: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
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
    expect(getSessionMessages(sessionsRef)).toHaveLength(1);
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
});
