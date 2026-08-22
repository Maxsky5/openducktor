import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createSessionTurnMetadata } from "../support/session-turn-metadata";
import { createSessionTurnTiming } from "../support/session-turn-timing";
import {
  buildSession,
  createRecordingSessionTodosUpdater,
  createSessionsRef,
  createSessionUpdater,
  findSession,
  getLastSessionMessage,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEventAdapter,
  type SessionUpdateFn,
} from "./session-events-test-harness";

describe("agent-orchestrator session errors and terminal state", () => {
  test("shows a recoverable turn error and accepts the following idle event", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([
      buildSession({ sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" } }),
    ]);

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
    handleEvent({
      type: "turn_error",
      externalSessionId: "session-1",
      messageId: "result-error-1",
      message: "Attachment could not be processed.",
      timestamp: "2026-02-22T08:00:10.000Z",
    });

    expect(findSession(sessionsRef, "session-1")?.status).toBe("running");
    expect(getLastSessionMessage(sessionsRef)).toMatchObject({
      id: "result-error-1",
      content: "Attachment could not be processed.",
      meta: {
        kind: "session_notice",
        tone: "error",
        reason: "session_error",
        title: "Error",
      },
    });

    handleEvent({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:11.000Z",
    });
    expect(findSession(sessionsRef, "session-1")?.status).toBe("idle");
  });

  test("starts queued turn timing after a recoverable turn error", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([
      buildSession({ sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" } }),
    ]);
    const session = findSession(sessionsRef, "session-1");
    if (!session) {
      throw new Error("Expected session");
    }
    const sessionKey = agentSessionIdentityKey(session);
    const turnMetadata = createSessionTurnMetadata();
    const turnTiming = createSessionTurnTiming();
    turnMetadata.recordModel(sessionKey, {
      providerId: "claude",
      modelId: "sonnet",
      runtimeKind: "claude",
    });
    turnTiming.recordTurnUserMessageTimestamp(sessionKey, "2026-02-22T08:00:00.000Z");

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession: createSessionUpdater(sessionsRef),
      turnMetadata,
      recordTurnUserMessageTimestamp: turnTiming.recordTurnUserMessageTimestamp,
      resolveTurnDurationMs: turnTiming.resolveTurnDurationMs,
      clearTurnDuration: turnTiming.clearTurnDuration,
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }
    handleEvent({
      type: "turn_error",
      externalSessionId: "session-1",
      message: "Attachment could not be processed.",
      timestamp: "2026-02-22T08:00:10.000Z",
    });
    expect(turnMetadata.readModel(sessionKey)).toBeUndefined();
    handleEvent({
      type: "user_message",
      externalSessionId: "session-1",
      messageId: "queued-user",
      message: "Continue without it.",
      parts: [{ kind: "text", text: "Continue without it." }],
      timestamp: "2026-02-22T08:00:11.000Z",
      state: "queued",
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "queued-answer",
      message: "Done.",
      timestamp: "2026-02-22T08:00:13.000Z",
    });

    expect(findSession(sessionsRef, "session-1")?.status).toBe("running");
    expect(getLastSessionMessage(sessionsRef)).toMatchObject({
      id: "queued-answer",
      meta: {
        kind: "assistant",
        durationMs: 2_000,
      },
    });
  });

  test("removes a running compaction notice when the compact turn fails", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([
      buildSession({ sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" } }),
    ]);

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
    handleEvent({
      type: "session_compaction_started",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:09.000Z",
      messageId: "compact-live",
      message: "Session compaction started.",
    });
    handleEvent({
      type: "turn_error",
      externalSessionId: "session-1",
      message: "Compaction failed.",
      timestamp: "2026-02-22T08:00:10.000Z",
    });
    handleEvent({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:11.000Z",
    });

    expect(findSession(sessionsRef, "session-1")?.status).toBe("idle");
    expect(
      getSessionMessages(sessionsRef).some(
        (message) =>
          message.meta?.kind === "session_notice" &&
          message.meta.reason === "session_compacted" &&
          message.meta.compactionStatus === "running",
      ),
    ).toBe(false);
    expect(getLastSessionMessage(sessionsRef)).toMatchObject({
      content: "Compaction failed.",
      meta: {
        kind: "session_notice",
        tone: "error",
        reason: "session_error",
        title: "Error",
      },
    });
  });

  test("records session_error as an error notice and clears pending requests", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        pendingApprovals: [
          {
            requestId: "perm-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: ["*.md"],
            action: { name: "read" },
            mutation: "read_only" as const,
            supportedReplyOutcomes: [
              "approve_once" as const,
              "approve_session" as const,
              "reject" as const,
            ],
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
    ]);

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
      type: "session_error",
      externalSessionId: "session-1",
      message: "Aborted",
      timestamp: "2026-02-22T08:00:10.000Z",
    });

    expect(findSession(sessionsRef, "session-1")?.status).toBe("error");
    expect(findSession(sessionsRef, "session-1")?.pendingApprovals).toHaveLength(0);
    expect(findSession(sessionsRef, "session-1")?.pendingQuestions).toHaveLength(0);
    const lastMessage = getLastSessionMessage(sessionsRef);
    expect(lastMessage?.content).toBe("Aborted");
    expect(lastMessage?.meta).toEqual({
      kind: "session_notice",
      tone: "error",
      reason: "session_error",
      title: "Error",
    });
  });

  test("keeps a terminal session error after the following finished event", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([
      buildSession({ sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" } }),
    ]);

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
    handleEvent({
      type: "session_error",
      externalSessionId: "session-1",
      message: "SDK stream failed.",
      timestamp: "2026-02-22T08:00:10.000Z",
    });
    handleEvent({
      type: "session_finished",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:11.000Z",
      message: "Session finished.",
    });

    expect(findSession(sessionsRef, "session-1")?.status).toBe("error");
    expect(getLastSessionMessage(sessionsRef)).toMatchObject({
      content: "SDK stream failed.",
      meta: {
        kind: "session_notice",
        tone: "error",
        reason: "session_error",
        title: "Error",
      },
    });
  });

  test("normalizes JSON-wrapped session_error payloads before rendering the error notice", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    ]);

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
      type: "session_error",
      externalSessionId: "session-1",
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

  test("renders a cancelled session notice when a user-requested stop aborts", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        stopRequestedAt: "2026-02-22T08:00:09.000Z",
        messages: [
          {
            id: "compact-running",
            role: "system",
            content: "Session compaction started.",
            timestamp: "2026-02-22T08:00:07.000Z",
            meta: {
              kind: "session_notice",
              tone: "info",
              reason: "session_compacted",
              title: "Compacting",
              compactionStatus: "running",
            },
          },
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
              toolType: "todo",
              status: "running",
            },
          },
        ],
        pendingApprovals: [
          {
            requestId: "perm-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: ["*.md"],
            action: { name: "read" },
            mutation: "read_only" as const,
            supportedReplyOutcomes: [
              "approve_once" as const,
              "approve_session" as const,
              "reject" as const,
            ],
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
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_error",
      externalSessionId: "session-1",
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
    expect(findSession(sessionsRef, "session-1")?.status).toBe("stopped");
    expect(findSession(sessionsRef, "session-1")?.stopRequestedAt).toBeNull();
    expect(
      getSessionMessages(sessionsRef).some((message) => message.content.includes("Session error:")),
    ).toBe(false);
    expect(
      getSessionMessages(sessionsRef).some(
        (message) =>
          message.meta?.kind === "session_notice" &&
          message.meta.reason === "session_compacted" &&
          message.meta.compactionStatus === "running",
      ),
    ).toBe(false);
  });

  test("handles todo updates and terminal finish", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const todosRecorder = createRecordingSessionTodosUpdater();
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([
      buildSession({ sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" } }),
    ]);

    const updateSessionOptions: Array<Parameters<SessionUpdateFn>[2]> = [];
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
      updateSessionTodos: todosRecorder.updateSessionTodos,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_todos_updated",
      externalSessionId: "session-1",
      todos: [{ id: "todo-1", content: "Do it", status: "pending", priority: "high" }],
      timestamp: "2026-02-22T08:00:03.000Z",
    });
    handleEvent({
      type: "session_finished",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:04.000Z",
      message: "Session finished.",
    });

    expect(todosRecorder.getTodos()).toHaveLength(1);
    expect(findSession(sessionsRef, "session-1")?.status).toBe("idle");
    expect(updateSessionOptions).toContain(undefined);
    expect(updateSessionOptions).toContainEqual({ persist: true });
  });

  test("does not update runtime todos when the observed session is gone", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const todosRecorder = createRecordingSessionTodosUpdater();
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([
      buildSession({ sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" } }),
    ]);
    const updateSession = createSessionUpdater(sessionsRef);

    await listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession,
      updateSessionTodos: todosRecorder.updateSessionTodos,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });

    sessionsRef.current = createSessionsRef([]).current;

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_todos_updated",
      externalSessionId: "session-1",
      todos: [{ id: "todo-1", content: "Do it", status: "pending", priority: "high" }],
      timestamp: "2026-02-22T08:00:03.000Z",
    });

    expect(todosRecorder.getTodos()).toEqual([]);
  });

  test("renders a cancelled session notice when a user-requested stop finishes normally", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
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
              toolType: "todo",
              status: "running",
            },
          },
        ],
        pendingApprovals: [
          {
            requestId: "perm-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: ["*.md"],
            action: { name: "read" },
            mutation: "read_only" as const,
            supportedReplyOutcomes: [
              "approve_once" as const,
              "approve_session" as const,
              "reject" as const,
            ],
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
    ]);

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
      type: "session_finished",
      externalSessionId: "session-1",
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
    expect(findSession(sessionsRef, "session-1")?.stopRequestedAt).toBeNull();
    expect(findSession(sessionsRef, "session-1")?.pendingApprovals).toHaveLength(0);
    expect(findSession(sessionsRef, "session-1")?.pendingQuestions).toHaveLength(0);
    expect(findSession(sessionsRef, "session-1")?.status).toBe("stopped");
  });

  test("keeps real failures on the error path even when stop intent was set", async () => {
    const handlers: Array<Parameters<SessionEventAdapter["subscribeEvents"]>[1]> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_externalSessionId, handler) => {
        handlers.push(handler);
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        stopRequestedAt: "2026-02-22T08:00:09.000Z",
      }),
    ]);

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
      type: "session_error",
      externalSessionId: "session-1",
      message: "Permission denied",
      timestamp: "2026-02-22T08:00:10.000Z",
    });

    expect(findSession(sessionsRef, "session-1")?.status).toBe("error");
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
});
