import { describe, expect, mock, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import { consumeClaudeSession } from "./claude-agent-sdk-session-io";
import {
  claudeQueryWithMessages,
  createClaudeSession,
  ignoreClaudeBackgroundFailure,
  openClaudeQueryWithMessages,
  waitForTimers,
} from "./claude-agent-sdk-session-io.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("sendClaudeUserMessage", () => {
  test.each([false, true])(
    "times a synthetic peer replay without replacing an active human turn, foreground %s",
    async (foregroundTurnActive) => {
      const events: AgentEvent[] = [];
      const session = createClaudeSession({
        foregroundTurnActive,
        activeSdkUserTurnCount: foregroundTurnActive ? 1 : 0,
        pendingUserTurnCount: foregroundTurnActive ? 1 : 0,
        acceptedUserMessages: [
          {
            messageId: "3b087ade-60ba-4824-a8ab-c8d012129136",
            text: "Review the files.",
            parts: [],
            timestamp: "2026-10-24T15:17:41.837Z",
          },
        ],
        query: claudeQueryWithMessages([
          claudeSdkMessageFixture({
            type: "user",
            uuid: "0a1ab7f4-898c-43fc-87dd-a52cfca2e1d4",
            isReplay: true,
            isSynthetic: true,
            timestamp: "2026-10-24T15:18:11.126Z",
            origin: { kind: "peer", from: "child", senderTaskId: "child" },
            message: { role: "user", content: "The child review is complete." },
          }),
          claudeSdkMessageFixture({
            type: "assistant",
            uuid: "cd97ee29-60d6-4ccf-b253-33538a953f21",
            timestamp: "2026-10-24T15:18:12.935Z",
            message: {
              id: "final-peer-response",
              role: "assistant",
              model: "claude-haiku-5-5",
              stop_reason: null,
              content: [{ type: "text", text: "The review found no issues." }],
            },
          }),
          claudeSdkMessageFixture({
            type: "result",
            uuid: "d5206c31-87e3-4502-992d-445fb408b22c",
            subtype: "success",
            result: "The review found no issues.",
            stop_reason: "end_turn",
            terminal_reason: "completed",
            origin: { kind: "peer", from: "child", senderTaskId: "child" },
          }),
        ]),
      });
      const sessionStore = createClaudeAgentSdkSessionStore();
      sessionStore.set(session);
      await consumeClaudeSession({
        session,
        now: () => "2026-10-24T15:18:12.943Z",
        emit: (_session, event) => events.push(event),
        onBackgroundFailure: ignoreClaudeBackgroundFailure,
        sessionStore,
      });
      const replies = events.filter((event) => event.type === "assistant_message");
      expect(replies).toHaveLength(1);
      for (const reply of replies) {
        expect(reply).toMatchObject({
          messageId: "final-peer-response",
        });
        if (foregroundTurnActive) expect(reply).not.toHaveProperty("durationMs");
        else expect(reply.durationMs).toBe(1_809);
      }
      expect(replies.at(-1)).toHaveProperty("forkPoint", { messageId: "final-peer-response" });
      expect(events.filter((event) => event.type === "user_message")).toEqual([]);
      if (!foregroundTurnActive) {
        expect(events.find((event) => event.type === "session_status")).toHaveProperty(
          "timestamp",
          "2026-10-24T15:18:12.935Z",
        );
      }
    },
  );

  test("uses Claude SDK message timestamps for live transcript events", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession({
      query: claudeQueryWithMessages([
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: "06f148f0-bd09-403a-8120-1b89a5737347",
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

    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(session);
    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
      sessionStore,
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        messageId: "06f148f0-bd09-403a-8120-1b89a5737347",
        timestamp: "2026-06-25T20:00:10.000Z",
      }),
    );
  });

  test("emits current context usage from the Claude SDK control API after result messages", async () => {
    const events: AgentEvent[] = [];

    const getContextUsage = mock(async () => {
      await Promise.resolve();
      if (session.abortController.signal.aborted) {
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
            uuid: "89c62bd4-3b2a-476e-8df9-1559ad2a22a1",
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

    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(session);
    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
      sessionStore,
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
            uuid: "89c62bd4-3b2a-476e-8df9-1559ad2a22a1",
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

    try {
      const sessionStore = createClaudeAgentSdkSessionStore();
      sessionStore.set(session);
      await consumeClaudeSession({
        session,
        now: () => "2026-06-25T20:01:00.000Z",
        emit: (_session, event) => events.push(event),
        onBackgroundFailure: ignoreClaudeBackgroundFailure,
        sessionStore,
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
        uuid: "06f148f0-bd09-403a-8120-1b89a5737347",
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

    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(session);
    const consumePromise = consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
      sessionStore,
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
            uuid: "89c62bd4-3b2a-476e-8df9-1559ad2a22a1",
            session_id: "session-1",
            timestamp: "2026-06-25T20:00:10.000Z",
            is_error: false,
            stop_reason: "tool_use",
            usage: {
              input_tokens: 20_000,
              output_tokens: 1_000,
            },
          }),
        ]),
        { getContextUsage },
      ),
    });

    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(session);
    await consumeClaudeSession({
      session,
      now: () => "2026-06-25T20:01:00.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
      sessionStore,
    });

    expect(getContextUsage).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "session_context_updated")).toBe(false);
  });
});
