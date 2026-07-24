import { describe, expect, test } from "bun:test";
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
  test("records session_error as an error notice and clears pending requests", async () => {
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

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "build",
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

  test("normalizes JSON-wrapped session_error payloads before rendering the error notice", async () => {
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

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "build",
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

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "build",
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
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const todosRecorder = createRecordingSessionTodosUpdater();
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
    });

    expect(todosRecorder.getTodos()).toHaveLength(1);
    expect(findSession(sessionsRef, "session-1")?.status).toBe("idle");
    expect(updateSessionOptions).toContain(undefined);
    expect(updateSessionOptions).toContainEqual({ persist: true });
  });

  test("does not update runtime todos when the observed session is gone", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const todosRecorder = createRecordingSessionTodosUpdater();
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

    const sessionsRef = createSessionsRef([
      buildSession({
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

    const sessionsRef = createSessionsRef([
      buildSession({
        role: "build",
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
