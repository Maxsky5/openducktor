import { describe, expect, mock, test } from "bun:test";
import {
  type AgentSessionState,
  buildSession,
  getLastSessionMessage,
  getSessionMessages,
  listenToAgentSessionEvents,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SessionEventAdapter,
} from "./session-events-test-harness";

describe("agent-orchestrator session errors and terminal state", () => {
  test("keeps permission pending when auto-reject reply fails", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const replyApproval = mock((_request: Parameters<SessionEventAdapter["replyApproval"]>[0]) =>
      Promise.reject(new Error("network down")),
    );
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval,
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-parent-session": buildSession({
          externalSessionId: "external-parent-session",
          role: "planner",
          messages: [
            {
              id: "subagent:part:assistant-parent:subtask-fail",
              role: "system",
              content: "Subagent (spec): Inspect repo",
              timestamp: "2026-02-22T08:00:01.000Z",
              meta: {
                kind: "subagent",
                partId: "subtask-fail",
                correlationKey: "part:assistant-parent:subtask-fail",
                status: "running",
                agent: "spec",
                prompt: "Inspect repo",
              },
            },
          ],
        }),
        "session-1": buildSession({ role: "spec" }),
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "approval_required",
      externalSessionId: "session-1",
      requestId: "perm-fail",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"write"}`,
      summary: `Approval request for ${"write"}.`,
      affectedPaths: ["edit file"],
      action: { name: "write" },
      mutation: "mutating" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
      metadata: { tool: "edit" },
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-1",
      subagentCorrelationKey: "part:assistant-parent:subtask-fail",
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(replyApproval).toHaveBeenCalledTimes(1);
    expect(sessionsRef.current["session-1"]?.pendingApprovals).toHaveLength(1);
    expect(sessionsRef.current["session-1"]?.pendingApprovals[0]?.requestId).toBe("perm-fail");
    expect(
      getSessionMessages(sessionsRef).some((message) =>
        message.content.includes("Automatic approval rejection failed"),
      ),
    ).toBe(true);
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: "part:assistant-parent:subtask-fail",
      externalSessionId: "external-1",
    });
  });

  test("keeps permission pending when auto-reject prompt rendering fails", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const replyApproval = mock((_request: Parameters<SessionEventAdapter["replyApproval"]>[0]) =>
      Promise.resolve(),
    );
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval,
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
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "approval_required",
      externalSessionId: "session-1",
      requestId: "perm-template-fail",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"write"}`,
      summary: `Approval request for ${"write"}.`,
      affectedPaths: ["edit file"],
      action: { name: "write" },
      mutation: "mutating" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
      metadata: { tool: "edit" },
      timestamp: "2026-02-22T08:00:05.000Z",
    });

    await Promise.resolve();

    expect(replyApproval).toHaveBeenCalledTimes(0);
    expect(sessionsRef.current["session-1"]?.pendingApprovals).toHaveLength(1);
    expect(sessionsRef.current["session-1"]?.pendingApprovals[0]?.requestId).toBe(
      "perm-template-fail",
    );
    expect(
      getSessionMessages(sessionsRef).some((message) =>
        message.content.includes("Automatic approval rejection failed"),
      ),
    ).toBe(true);
  });

  test("records session_error as an error notice and clears pending requests", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
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
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
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

    expect(sessionsRef.current["session-1"]?.status).toBe("error");
    expect(sessionsRef.current["session-1"]?.pendingApprovals).toHaveLength(0);
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
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "build",
        }),
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
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

  test("renders a cancelled session notice when a user-requested stop aborts", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
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
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
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
    expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
    expect(sessionsRef.current["session-1"]?.stopRequestedAt).toBeNull();
    expect(
      getSessionMessages(sessionsRef).some((message) => message.content.includes("Session error:")),
    ).toBe(false);
  });

  test("handles question/todo updates and terminal finish", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
    };

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({ role: "build" }),
      },
    };

    const updateSessionOptions: unknown[] = [];
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
      options?: unknown,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      updateSessionOptions.push(options);
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "question_required",
      externalSessionId: "session-1",
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
      externalSessionId: "session-1",
      todos: [{ id: "todo-1", content: "Do it", status: "pending", priority: "high" }],
      timestamp: "2026-02-22T08:00:03.000Z",
    });
    handleEvent({
      type: "session_finished",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:04.000Z",
    });

    expect(sessionsRef.current["session-1"]?.todos).toHaveLength(1);
    expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
    expect(updateSessionOptions).toContainEqual({ persist: false });
  });

  test("renders a cancelled session notice when a user-requested stop finishes normally", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
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
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
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
    expect(sessionsRef.current["session-1"]?.stopRequestedAt).toBeNull();
    expect(sessionsRef.current["session-1"]?.pendingApprovals).toHaveLength(0);
    expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    expect(sessionsRef.current["session-1"]?.status).toBe("stopped");
  });

  test("keeps real failures on the error path even when stop intent was set", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
        handlers.push(
          handler as unknown as (event: { type: string; [key: string]: unknown }) => void,
        );
        return () => {};
      },
      replyApproval: async () => {},
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
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    listenToAgentSessionEvents({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: {} },
      updateSession,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
      refreshTaskData: async () => {},
      resolveRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
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
});
