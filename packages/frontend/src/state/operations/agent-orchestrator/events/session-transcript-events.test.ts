import { describe, expect, test } from "bun:test";
import {
  type AgentSessionState,
  attachAgentSessionListener,
  buildSession,
  getSessionMessages,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SessionEvent,
  type SessionEventAdapter,
  withMockedToast,
} from "./session-events-test-harness";

describe("agent-orchestrator session transcript events", () => {
  test("records inputReadyAtMs when tool input first becomes meaningful", () => {
    const originalDateNow = Date.now;
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
        "session-1": buildSession({ role: "planner" }),
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

    try {
      attachAgentSessionListener({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        sessionsRef,
        draftRawBySessionRef: { current: {} },
        draftSourceBySessionRef: { current: {} },
        draftMessageIdBySessionRef: { current: {} },
        draftFlushTimeoutBySessionRef: { current: {} },
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
          status: "pending",
          input: {},
          output: "",
          error: "",
        },
      });

      const queuedMessage = getSessionMessages(sessionsRef).find(
        (message) => message.meta?.kind === "tool" && message.meta.callId === "call-1",
      );
      if (!queuedMessage || queuedMessage.meta?.kind !== "tool") {
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
      if (!inputReadyMessage || inputReadyMessage.meta?.kind !== "tool") {
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
      if (!completedMessage || completedMessage.meta?.kind !== "tool") {
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
        subscribeEvents: (_externalSessionId, handler) => {
          handlers.push(handler);
          return () => {};
        },
        replyApproval: async () => {},
      };
      const sessionsRef: { current: Record<string, AgentSessionState> } = {
        current: {
          "session-1": buildSession({ role: "build" }),
        },
      };

      attachAgentSessionListener({
        adapter,
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        sessionsRef,
        draftRawBySessionRef: { current: {} },
        draftSourceBySessionRef: { current: {} },
        draftMessageIdBySessionRef: { current: {} },
        draftFlushTimeoutBySessionRef: { current: {} },
        turnStartedAtBySessionRef: { current: {} },
        updateSession: () => {},
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
        output: "ok",
        expectedRefreshTaskDataCalls: 1,
      },
      {
        name: "todo tool refresh",
        tool: "todowrite",
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

        attachAgentSessionListener({
          adapter,
          repoPath: "/tmp/repo",
          externalSessionId: "session-1",
          sessionsRef,
          draftRawBySessionRef: { current: {} },
          draftSourceBySessionRef: { current: {} },
          draftMessageIdBySessionRef: { current: {} },
          draftFlushTimeoutBySessionRef: { current: {} },
          turnStartedAtBySessionRef: { current: {} },
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
        "session-1": buildSession(),
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

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
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
    expect(userMessages?.[0]?.id).toBe("user-message-1");
    expect(userMessages?.[0]?.content).toBe("Generate the pull request");
    if (!userMessages?.[0]?.meta || userMessages[0].meta.kind !== "user") {
      throw new Error("Expected canonical user message metadata");
    }
    expect(userMessages[0].meta.parts).toEqual([
      {
        kind: "text",
        text: "Generate the pull request",
      },
    ]);
    expect(userMessages[0].meta.providerId).toBe("openai");
    expect(userMessages[0].meta.modelId).toBe("gpt-5");
    expect(userMessages[0].meta.variant).toBe("high");
    expect(userMessages[0].meta.profileId).toBe("Hephaestus");
    expect(userMessages[0].meta.state).toBe("read");
  });

  test("appends session compaction notices without changing live session state", () => {
    const handlers: Array<(event: SessionEvent) => void> = [];
    const updateSessionOptions: Array<{ persist?: boolean } | undefined> = [];
    const adapter: SessionEventAdapter = {
      subscribeEvents: (_externalSessionId, handler) => {
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
      draftAssistantText: "draft text",
      draftAssistantMessageId: "draft-assistant-1",
      draftReasoningText: "draft reasoning",
      draftReasoningMessageId: "draft-reasoning-1",
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

    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "session-1": buildSession({
          role: "build",
          messages: [previousMessage],
          ...protectedSessionState,
        }),
      },
    };

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
      options?: { persist?: boolean },
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

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: { "session-1": { reasoning: "draft reasoning" } } },
      draftSourceBySessionRef: { current: { "session-1": { reasoning: "delta" } } },
      draftMessageIdBySessionRef: { current: { "session-1": { reasoning: "draft-reasoning-1" } } },
      draftFlushTimeoutBySessionRef: { current: {} },
      turnStartedAtBySessionRef: { current: { "session-1": 1_777_000_000_000 } },
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
      type: "session_compacted",
      externalSessionId: "session-1",
      timestamp: "2026-05-18T21:01:00.000Z",
      message: "Session compacted.",
    });

    const session = sessionsRef.current["session-1"];
    if (!session) {
      throw new Error("Expected session to exist");
    }
    const messages = getSessionMessages(sessionsRef);
    const notice = messages.at(-1);
    expect(messages[0]).toEqual(previousMessage);
    expect(notice).toEqual(
      expect.objectContaining({
        role: "system",
        content: "Session compacted.",
        timestamp: "2026-05-18T21:01:00.000Z",
        meta: {
          kind: "session_notice",
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
        },
      }),
    );
    expect(updateSessionOptions).toContainEqual({ persist: true });
    expect(session).toEqual(
      expect.objectContaining({
        ...protectedSessionState,
      }),
    );
  });

  test("reconciles queued user_message updates in place when the agent reads the turn", () => {
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
        "session-1": buildSession(),
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

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
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
    expect(userMessages?.[0]?.content).toBe("Queued follow-up");
    if (!userMessages?.[0]?.meta || userMessages[0].meta.kind !== "user") {
      throw new Error("Expected queued user message metadata");
    }
    expect(userMessages[0].meta.parts).toEqual([
      {
        kind: "text",
        text: "Queued follow-up",
      },
    ]);
    expect(userMessages[0].meta.state).toBe("read");
  });

  test("flushes queued non-immediate events in a single session commit", () => {
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
        "session-1": buildSession({ status: "starting" }),
      },
    };
    let updateSessionCalls = 0;

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      updateSessionCalls += 1;
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    const unsubscribe = attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
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
    expect(sessionsRef.current["session-1"]?.status).toBe("running");
    expect(getSessionMessages(sessionsRef)).toHaveLength(1);
    expect(sessionsRef.current["session-1"]?.todos).toEqual([
      {
        id: "todo-1",
        content: "Investigate live performance",
        status: "in_progress",
        priority: "high",
      },
    ]);
  });

  test("flushes queued work before applying an immediate event", () => {
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
        "session-1": buildSession({ status: "starting" }),
      },
    };
    let updateSessionCalls = 0;

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      updateSessionCalls += 1;
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
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

  test("collapses assistant stream chunks across a queued flush", () => {
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
        "session-1": buildSession({ status: "running", role: "build" }),
      },
    };
    let updateSessionCalls = 0;

    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = sessionsRef.current[externalSessionId];
      if (!current) {
        return;
      }
      updateSessionCalls += 1;
      sessionsRef.current = {
        ...sessionsRef.current,
        [externalSessionId]: updater(current),
      };
    };

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
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

  test("prefers final assistant message over earlier streamed text in the same batch", () => {
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
        "session-1": buildSession({ status: "running", role: "build" }),
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

    attachAgentSessionListener({
      adapter,
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      eventBatchWindowMs: 25,
      sessionsRef,
      draftRawBySessionRef: { current: {} },
      draftSourceBySessionRef: { current: {} },
      draftMessageIdBySessionRef: { current: {} },
      draftFlushTimeoutBySessionRef: { current: {} },
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
