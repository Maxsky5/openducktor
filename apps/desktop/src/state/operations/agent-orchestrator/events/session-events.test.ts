import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { type SessionEventAdapter, attachAgentSessionListener } from "./session-events";

const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeId: null,
  runId: null,
  baseUrl: "http://127.0.0.1:4321",
  workingDirectory: "/tmp/repo",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  ...overrides,
});

describe("agent-orchestrator-session-events", () => {
  test("auto-rejects mutating permissions for read-only roles", async () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const replyPermission = mock(
      (_request: Parameters<SessionEventAdapter["replyPermission"]>[0]) => Promise.resolve(),
    );
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: {
            type: string;
            [key: string]: unknown;
          }) => void,
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
      loadSessionTodos: async () => {},
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
      sessionsRef.current["session-1"]?.messages.some((message) =>
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
          handler as unknown as (event: {
            type: string;
            [key: string]: unknown;
          }) => void,
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
      loadSessionTodos: async () => {},
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
      sessionsRef.current["session-1"]?.messages.some((message) =>
        message.content.includes("Automatic permission rejection failed"),
      ),
    ).toBe(true);
  });

  test("clears pending requests when session_error is received", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: {
            type: string;
            [key: string]: unknown;
          }) => void,
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
      loadSessionTodos: async () => {},
    });

    const handleEvent = handlers[0];
    if (!handleEvent) {
      throw new Error("Expected session event handler to be registered");
    }

    handleEvent({
      type: "session_error",
      sessionId: "session-1",
      message: "boom",
      timestamp: "2026-02-22T08:00:10.000Z",
    });

    expect(sessionsRef.current["session-1"]?.status).toBe("error");
    expect(sessionsRef.current["session-1"]?.pendingPermissions).toHaveLength(0);
    expect(sessionsRef.current["session-1"]?.pendingQuestions).toHaveLength(0);
    expect(
      sessionsRef.current["session-1"]?.messages.some((message) =>
        message.content.includes("Session error:"),
      ),
    ).toBe(true);
  });

  test("handles question/todo updates and terminal finish", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: {
            type: string;
            [key: string]: unknown;
          }) => void,
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
      loadSessionTodos: async () => {},
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

  test("finalizes assistant draft through status transitions", () => {
    const handlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_sessionId, handler) => {
        handlers.push(
          handler as unknown as (event: {
            type: string;
            [key: string]: unknown;
          }) => void,
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
      loadSessionTodos: async () => {},
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
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "assistant" && message.content.includes("Partial answer"),
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
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
          handler as unknown as (event: {
            type: string;
            [key: string]: unknown;
          }) => void,
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
      loadSessionTodos: async () => {},
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
    expect(sessionsRef.current["session-1"]?.messages.length).toBeGreaterThan(0);

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
        status: "completed",
        output: "MCP error -32602: Input validation error",
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
      timestamp: "2026-02-22T08:00:03.000Z",
      message: "Final assistant output",
      totalTokens: 42,
    });

    handleEvent({
      type: "assistant_delta",
      sessionId: "session-1",
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
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "thinking" && message.content.includes("Reasoning"),
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "tool" && message.meta?.kind === "tool",
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) =>
          message.role === "tool" &&
          message.meta?.kind === "tool" &&
          message.meta.tool === "odt_set_plan" &&
          message.meta.status === "error",
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some((message) =>
        message.content.includes("Subtask (build): Done subtask"),
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) =>
          message.role === "assistant" && message.content.includes("Final assistant output"),
      ),
    ).toBe(true);
    expect(
      sessionsRef.current["session-1"]?.messages.some(
        (message) => message.role === "assistant" && message.content.includes("Idle follow-up"),
      ),
    ).toBe(true);
  });
});
