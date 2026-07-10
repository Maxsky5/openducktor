import { describe, expect, test } from "bun:test";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { consumeClaudeSession, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  claudeQueryWithMessages,
  createClaudeSession,
  emptyClaudeQuery,
  openClaudeQueryWithMessages,
  throwingClaudeQuery,
  waitForTimers,
} from "./claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";

describe("consumeClaudeSession lifecycle", () => {
  test("sends the first resumed user message after an unattributed running replay", async () => {
    const events: AgentEvent[] = [];
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const sessionStore = createClaudeAgentSdkSessionStore();
    const openQuery = openClaudeQueryWithMessages([
      {
        type: "system",
        subtype: "session_state_changed",
        state: "running",
        uuid: "state-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    ]);
    const session = createClaudeSession({
      activity: "idle",
      query: openQuery.query,
      queue,
    });
    sessionStore.set(session);

    const consumePromise = consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: (_session, event) => events.push(event),
    });
    await waitForTimers();

    const accepted = await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:01.000Z",
      randomId: () => "message-1",
      emit: (_session, event) => events.push(event),
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        parts: [{ kind: "text", text: "Hi" }],
      },
    });

    expect(accepted.state).toBe("read");
    expect(pushed).toEqual([
      expect.objectContaining({
        type: "user",
        uuid: "message-1",
      }),
    ]);

    sessionStore.sessions.delete(session.externalSessionId);
    openQuery.release();
    await consumePromise;
  });

  test("flushes a queued message when a terminal result follows a terminal assistant frame", async () => {
    const events: AgentEvent[] = [];
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const sessionStore = createClaudeAgentSdkSessionStore();
    const queuedMessage: SDKUserMessage = {
      type: "user",
      uuid: "00000000-0000-4000-8000-000000000002",
      session_id: "session-1",
      timestamp: "2026-06-25T20:00:01.000Z",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{ type: "text", text: "queued follow-up" }],
      },
    };
    const session = createClaudeSession({
      acceptedUserMessages: [
        {
          messageId: "00000000-0000-4000-8000-000000000001",
          parts: [{ kind: "text", text: "first turn" }],
          text: "first turn",
          timestamp: "2026-06-25T20:00:00.000Z",
        },
        {
          messageId: "00000000-0000-4000-8000-000000000002",
          parts: [{ kind: "text", text: "queued follow-up" }],
          text: "queued follow-up",
          timestamp: "2026-06-25T20:00:01.000Z",
        },
      ],
      activeSdkUserTurnCount: 1,
      activity: "running",
      pendingUserTurnCount: 2,
      query: claudeQueryWithMessages([
        {
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          message: {
            role: "assistant",
            model: "claude-opus-4-6",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "first turn done" }],
          },
        } as unknown as SDKMessage,
        {
          type: "result",
          subtype: "success",
          uuid: "result-1",
          session_id: "session-1",
          is_error: false,
          result: "first turn done",
          stop_reason: "end_turn",
          terminal_reason: "completed",
          usage: { input_tokens: 0, output_tokens: 0 },
        } as unknown as SDKMessage,
      ]),
      queue,
      queuedSdkMessages: [queuedMessage],
      sdkState: "running",
    });
    sessionStore.set(session);

    await consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:02.000Z",
      emit: (_session, event) => events.push(event),
    });

    expect(pushed).toEqual([queuedMessage]);
    expect(events.map((event) => event.type)).toContain("assistant_message");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "user_message",
        messageId: "00000000-0000-4000-8000-000000000002",
        state: "read",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session_status",
        status: { type: "busy", message: null },
      }),
    );
  });

  test("keeps terminal assistant frames running until the SDK result arrives", async () => {
    const events: AgentEvent[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore();
    const openQuery = openClaudeQueryWithMessages([
      {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
        },
      } as unknown as SDKMessage,
    ]);
    const session = createClaudeSession({
      acceptedUserMessages: [
        {
          messageId: "00000000-0000-4000-8000-000000000001",
          parts: [{ kind: "text", text: "write the spec" }],
          text: "write the spec",
          timestamp: "2026-06-25T20:00:00.000Z",
        },
      ],
      activeSdkUserTurnCount: 1,
      activity: "running",
      pendingUserTurnCount: 1,
      query: openQuery.query,
      sdkState: "running",
    });
    sessionStore.set(session);

    const consumePromise = consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:02.000Z",
      emit: (_session, event) => events.push(event),
    });

    await waitForTimers();

    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);

    sessionStore.sessions.delete(session.externalSessionId);
    openQuery.release();
    await consumePromise;
  });

  test("flushes queued input after terminal result completion without waiting for SDK idle", async () => {
    const events: AgentEvent[] = [];
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const queuedMessage: SDKUserMessage = {
      type: "user",
      uuid: "00000000-0000-4000-8000-000000000002",
      session_id: "session-1",
      timestamp: "2026-06-25T20:00:01.000Z",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{ type: "text", text: "queued follow-up" }],
      },
    };
    const sessionStore = createClaudeAgentSdkSessionStore();
    const openQuery = openClaudeQueryWithMessages([
      {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "first turn done" }],
        },
      } as unknown as SDKMessage,
      {
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        is_error: false,
        result: "first turn done",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as SDKMessage,
    ]);
    const session = createClaudeSession({
      acceptedUserMessages: [
        {
          messageId: "00000000-0000-4000-8000-000000000001",
          parts: [{ kind: "text", text: "first turn" }],
          text: "first turn",
          timestamp: "2026-06-25T20:00:00.000Z",
        },
        {
          messageId: "00000000-0000-4000-8000-000000000002",
          parts: [{ kind: "text", text: "queued follow-up" }],
          text: "queued follow-up",
          timestamp: "2026-06-25T20:00:01.000Z",
        },
      ],
      activeSdkUserTurnCount: 1,
      activity: "running",
      pendingUserTurnCount: 2,
      query: openQuery.query,
      queue,
      queuedSdkMessages: [queuedMessage],
      sdkState: "running",
    });
    sessionStore.set(session);

    const consumePromise = consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:02.000Z",
      emit: (_session, event) => events.push(event),
    });

    await waitForTimers();

    expect(pushed).toEqual([queuedMessage]);
    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.queuedSdkMessages).toEqual([]);
    expect(events.some((event) => event.type === "session_idle")).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "user_message" &&
          event.messageId === "00000000-0000-4000-8000-000000000002" &&
          event.state === "read",
      ),
    ).toBe(true);

    sessionStore.sessions.delete(session.externalSessionId);
    openQuery.release();
    await consumePromise;
  });

  test("terminalizes a live session when the SDK iterator completes", async () => {
    const events: AgentEvent[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore();
    const session = createClaudeSession({
      activity: "running",
      query: emptyClaudeQuery(),
    });
    sessionStore.set(session);

    await consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: (_session, event) => events.push(event),
    });

    expect(session.activity).toBe("stopped");
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
    expect(events).toEqual([
      {
        type: "session_finished",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        message: "Claude Agent SDK session stream ended.",
      },
    ]);
  });

  test("terminalizes a live session when the SDK iterator fails", async () => {
    const events: AgentEvent[] = [];
    const sessionStore = createClaudeAgentSdkSessionStore();
    const session = createClaudeSession({
      activity: "running",
      query: throwingClaudeQuery(new Error("transport crashed")),
    });
    sessionStore.set(session);

    await consumeClaudeSession({
      session,
      sessionStore,
      now: () => "2026-06-25T20:00:00.000Z",
      emit: (_session, event) => events.push(event),
    });

    expect(session.activity).toBe("stopped");
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
    expect(events).toEqual([
      {
        type: "session_error",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        message: "transport crashed",
      },
    ]);

    await expect(
      sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:01.000Z",
        randomId: () => "message-1",
        emit: () => {},
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [{ kind: "text", text: "retry" }],
        },
      }),
    ).rejects.toThrow(
      "Claude Agent SDK session is no longer accepting messages after its SDK stream stopped.",
    );
  });
});
