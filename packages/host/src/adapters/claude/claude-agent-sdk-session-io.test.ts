import { describe, expect, mock, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { consumeClaudeSession } from "./claude-agent-sdk-session-io";
import {
  claudeQueryWithMessages,
  createClaudeSession,
  openClaudeQueryWithMessages,
  waitForTimers,
} from "./claude-agent-sdk-session-io.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("sendClaudeUserMessage", () => {
  test("uses Claude SDK message timestamps for live transcript events", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession({
      query: claudeQueryWithMessages([
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:10.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Done." }],
          },
        }),
      ]),
    });
    const closed = { value: false };

    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        messageId: "assistant-1",
        timestamp: "2026-06-25T20:00:10.000Z",
      }),
    );
  });

  test("emits current context usage from the Claude SDK control API after result messages", async () => {
    const events: AgentEvent[] = [];
    const closed = { value: false };
    const getContextUsage = mock(async () => {
      await Promise.resolve();
      if (closed.value) {
        throw new Error("Query was closed before context usage was read.");
      }
      return {
        totalTokens: 42_000,
        maxTokens: 1_000_000,
      };
    });
    const session = createClaudeSession({
      query: Object.assign(
        claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            uuid: "result-1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            result: "Done.",
            stop_reason: "end_turn",
            terminal_reason: "completed",
            usage: {
              input_tokens: 1_600_000,
              output_tokens: 74_127,
            },
          }),
        ]),
        { getContextUsage },
      ),
    });

    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
          session.query.close();
        },
      },
    });
    await waitForTimers();

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:10.000Z",
      totalTokens: 42_000,
      contextWindow: 1_000_000,
    });
    const assistantMessage = events.find((event) => event.type === "assistant_message");
    expect(assistantMessage).toEqual(
      expect.not.objectContaining({
        totalTokens: 1_674_127,
      }),
    );
  });

  test("does not emit a terminal session error when live context usage refresh fails", async () => {
    const events: AgentEvent[] = [];
    const warn = console.warn;
    const warnMock = mock(() => {});
    console.warn = warnMock;
    const getContextUsage = mock(async () => {
      throw new Error("context unavailable");
    });
    const session = createClaudeSession({
      query: Object.assign(
        claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            uuid: "result-1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            result: "Done.",
            stop_reason: "end_turn",
            terminal_reason: "completed",
          }),
        ]),
        { getContextUsage },
      ),
    });
    const closed = { value: false };

    try {
      await consumeClaudeSession({
        session,
        now: () => "2026-06-25T20:01:00.000Z",
        emit: (_session, event) => events.push(event),
        sessionStore: {
          get: (externalSessionId) =>
            !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
          close: () => {
            closed.value = true;
            session.query.close();
          },
        },
      });
      await waitForTimers();
    } finally {
      console.warn = warn;
    }

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      "Failed to refresh Claude context usage for session 'session-1': context unavailable",
    );
    expect(events).toContainEqual({
      type: "session_context_error",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:10.000Z",
      message: "context unavailable",
    });
    expect(events.some((event) => event.type === "session_error")).toBe(false);
    expect(events.some((event) => event.type === "session_finished")).toBe(true);
  });

  test("refreshes current context usage while a live assistant message is still streaming", async () => {
    const events: AgentEvent[] = [];
    const getContextUsage = mock(async () => ({
      totalTokens: 95_000,
      maxTokens: 200_000,
    }));
    const { query, release } = openClaudeQueryWithMessages([
      claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        timestamp: "2026-06-25T20:00:10.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: null,
          content: [{ type: "text", text: "Working..." }],
        },
      }),
    ]);
    const session = createClaudeSession({
      query: Object.assign(query, { getContextUsage }),
    });
    const closed = { value: false };

    const consumePromise = consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    await waitForTimers();

    expect(getContextUsage).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:10.000Z",
      totalTokens: 95_000,
      contextWindow: 200_000,
    });
    expect(events.some((event) => event.type === "session_finished")).toBe(false);

    release();
    await consumePromise;
  });

  test("does not refresh context usage for tool-use continuation results", async () => {
    const events: AgentEvent[] = [];
    const getContextUsage = mock(async () => ({
      totalTokens: 42_000,
      maxTokens: 1_000_000,
    }));
    const session = createClaudeSession({
      query: Object.assign(
        claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "result",
            subtype: "success",
            uuid: "result-1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            stop_reason: "tool_use",
            terminal_reason: "tool_use",
            usage: {
              input_tokens: 20_000,
              output_tokens: 1_000,
            },
          }),
        ]),
        { getContextUsage },
      ),
    });
    const closed = { value: false };

    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      sessionStore: {
        get: (externalSessionId) =>
          !closed.value && externalSessionId === session.externalSessionId ? session : undefined,
        close: () => {
          closed.value = true;
        },
      },
    });

    expect(getContextUsage).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "session_context_updated")).toBe(false);
  });
});
