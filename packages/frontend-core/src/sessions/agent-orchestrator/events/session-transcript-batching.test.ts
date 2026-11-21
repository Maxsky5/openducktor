import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "../../../lib/agent-session-identity";
import { createSessionTurnTiming } from "../support/session-turn-timing";
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
  test("keeps streamed reasoning visible before completion under its hydrated identity", async () => {
    let handleEvent: ((event: SessionEvent) => void) | undefined;
    const adapter: SessionEventAdapter = {
      subscribeEvents: async (_session, handler) => {
        handleEvent = handler;
        return () => {};
      },
      replyApproval: async () => {},
    };
    const sessionsRef = createSessionsRef([buildSession()]);
    const unsubscribe = await listenToAgentSessionEvents({
      adapter,
      sessionsRef,
      updateSession: createSessionUpdater(sessionsRef),
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });
    try {
      for (const completed of [false, true]) {
        handleEvent!({
          type: "assistant_part",
          externalSessionId: "session-1",
          timestamp: "2026-02-22T08:00:01.000Z",
          part: {
            kind: "reasoning",
            messageId: "msg-native",
            partId: "msg-native:reasoning:0",
            text: completed ? "Checking the source and plan." : "Checking the source",
            completed,
          },
        });
        const reasoning = getSessionMessages(sessionsRef).filter(
          (message) => message.meta?.kind === "reasoning",
        );
        expect(reasoning).toHaveLength(1);
        expect(reasoning[0]).toMatchObject({
          role: "thinking",
          content: completed ? "Checking the source and plan." : "Checking the source",
          meta: { partId: "msg-native:reasoning:0", completed },
        });
      }
    } finally {
      unsubscribe();
    }
  });

  test("prefers final assistant message over earlier streamed text in the same batch", async () => {
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
        status: "running",
        sessionAssociation: {
          kind: "workflow",
          workspaceId: "workspace-1",
          taskId: "task-1",
          role: "build",
        },
      }),
    ]);

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
      (message) => message.id === "text:assistant-1:text-1",
    );
    expect(assistantMessage?.content).toBe("Final answer");
  });

  test("keeps one Claude final response row from streaming through completion", async () => {
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
        sessionAssociation: {
          kind: "workflow",
          workspaceId: "workspace-1",
          taskId: "task-1",
          role: "build",
        },
        selectedModel: {
          providerId: "claude",
          modelId: "sonnet",
          runtimeKind: "claude",
        },
      }),
    ]);
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
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:00.000Z",
      part: {
        kind: "reasoning",
        messageId: "response-final",
        partId: "response-final:thinking:0",
        text: "Checking",
        completed: true,
      },
    });
    handleEvent({
      type: "assistant_delta",
      externalSessionId: "session-1",
      channel: "text",
      messageId: "response-final",
      delta: "Final answer",
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    handleEvent({
      type: "assistant_part",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:01.500Z",
      part: {
        kind: "reasoning",
        messageId: "response-final",
        partId: "response-final:thinking:0",
        text: "Checking",
        completed: true,
      },
    });
    handleEvent({
      type: "assistant_message",
      externalSessionId: "session-1",
      messageId: "response-final",
      message: "Final answer",
      timestamp: "2026-02-22T08:00:02.000Z",
      model: {
        providerId: "claude",
        modelId: "sonnet",
        runtimeKind: "claude",
      },
    });
    handleEvent({
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-02-22T08:00:02.000Z",
    });

    expect(
      getSessionMessages(sessionsRef)
        .filter((message) => message.role === "assistant")
        .map((message) => ({ id: message.id, content: message.content })),
    ).toEqual([{ id: "response-final", content: "Final answer" }]);
    expect(
      getSessionMessages(sessionsRef)
        .filter((message) => message.role === "thinking")
        .map((message) => message.content),
    ).toEqual(["Checking"]);
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
        runtimeKind: "claude",
        status: "running",
        sessionAssociation: {
          kind: "workflow",
          workspaceId: "workspace-1",
          taskId: "task-1",
          role: "spec",
        },
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
      (message) =>
        message.id === "text:claude-stream:session-1:1:1:0:claude-stream:session-1:1:1:0:text:0",
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
