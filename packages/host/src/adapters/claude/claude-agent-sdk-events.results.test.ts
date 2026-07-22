import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("handleClaudeSdkMessage result events", () => {
  test("keeps an active SDK user turn open for non-terminal tool-use results", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.activeSdkUserTurnCount = 1;
    session.pendingUserTurnCount = 1;

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.activity).toBe("running");
  });

  test("closes the active SDK user turn on terminal results while queued turns remain pending", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.activeSdkUserTurnCount = 1;
    session.pendingUserTurnCount = 2;

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "end_turn",
        result: "done",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.activity).toBe("running");
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "session_idle",
      }),
    );
  });

  test("emits final assistant text carried only by a successful result", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        is_error: false,
        result: "FINALSMOKE_VISIBLE",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    expect(session.activity).toBe("idle");
    expect(events).toEqual([
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        messageId: "result-1",
        message: "FINALSMOKE_VISIBLE",
      },
      {
        type: "session_idle",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
      },
    ]);
  });

  test("preserves the Claude model when a result finalizes a preceding assistant payload", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.acceptedUserMessages.push({});
    session.pendingUserTurnCount = 1;
    const input = {
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-final",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Final answer" }],
        },
      }),
    });

    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:02.000Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        is_error: false,
        duration_ms: 2_000,
        result: "Final answer",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    });

    expect(events).toContainEqual({
      type: "assistant_message",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:02.000Z",
      messageId: "result-1",
      message: "Final answer",
      durationMs: 2_000,
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
      },
    });
  });

  test("finalizes streamed assistant text with the stream id when the result carries the final text", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.acceptedUserMessages.push({});
    session.pendingUserTurnCount = 1;
    const commonInput = {
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...commonInput,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "partial-event-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Final result" },
        },
      }),
    });

    handleClaudeSdkMessage({
      ...commonInput,
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        is_error: false,
        result: "Final result",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_delta",
        messageId: "claude-stream:session-1:1:1:0",
      }),
      expect.objectContaining({
        type: "assistant_message",
        messageId: "claude-stream:session-1:1:1:0",
        message: "Final result",
      }),
      expect.objectContaining({
        type: "session_idle",
      }),
    ]);
  });

  test("finalizes multi-block streamed result text without keeping duplicate stream rows", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.acceptedUserMessages.push({});
    session.pendingUserTurnCount = 1;
    session.streamAssistantMessageIdsByBlockIndex.set(0, "claude-stream:session-1:1:1:0");
    session.streamAssistantMessageIdsByBlockIndex.set(1, "claude-stream:session-1:1:1:1");
    const commonInput = {
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...commonInput,
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        is_error: false,
        result: "First block\nSecond block",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "transcript_retracted",
        messageIds: ["claude-stream:session-1:1:1:1"],
      }),
      expect.objectContaining({
        type: "assistant_message",
        messageId: "claude-stream:session-1:1:1:0",
        message: "First block\nSecond block",
      }),
      expect.objectContaining({
        type: "session_idle",
      }),
    ]);
  });

  test("does not reuse stream ids after result-finalized text when Claude omits message_start", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.acceptedUserMessages.push({});
    session.pendingUserTurnCount = 1;
    const commonInput = {
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...commonInput,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "partial-event-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "First result" },
        },
      }),
    });
    handleClaudeSdkMessage({
      ...commonInput,
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        is_error: false,
        result: "First result",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    session.acceptedUserMessages.push({});
    session.pendingUserTurnCount = 1;
    handleClaudeSdkMessage({
      ...commonInput,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "partial-event-2",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Second result" },
        },
      }),
    });

    expect(
      events
        .filter((event) => event.type === "assistant_delta" || event.type === "assistant_message")
        .map((event) => event.messageId),
    ).toEqual([
      "claude-stream:session-1:1:1:0",
      "claude-stream:session-1:1:1:0",
      "claude-stream:session-1:2:2:0",
    ]);
  });

  test("keeps streamed tool-use draft text separate from final result text", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.acceptedUserMessages.push({});
    session.pendingUserTurnCount = 1;
    const commonInput = {
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...commonInput,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "partial-event-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Now let me write and persist the spec." },
        },
      }),
    });

    handleClaudeSdkMessage({
      ...commonInput,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-tool-use",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Now let me write and persist the spec." },
            {
              type: "tool_use",
              id: "tool-1",
              name: "mcp__openducktor__odt_set_spec",
              input: { taskId: "task-1", markdown: "# Spec" },
            },
          ],
        },
      }),
    });

    handleClaudeSdkMessage({
      ...commonInput,
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        is_error: false,
        result: "Spec persisted and task moved to spec_ready.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_delta",
        messageId: "claude-stream:session-1:1:1:0",
        delta: "Now let me write and persist the spec.",
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "text",
          messageId: "claude-stream:session-1:1:1:0",
          text: "Now let me write and persist the spec.",
          completed: true,
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          callId: "tool-1",
          status: "pending",
        }),
      }),
      expect.objectContaining({
        type: "assistant_message",
        messageId: "result-1",
        message: "Spec persisted and task moved to spec_ready.",
      }),
      expect.objectContaining({
        type: "session_idle",
      }),
    ]);
  });

  test("does not treat result usage totals as current context usage", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        is_error: false,
        result: "FINAL_WITH_USAGE",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 3, output_tokens: 5 },
        modelUsage: {
          "claude-sonnet-4-6": {
            contextWindow: 200_000,
            maxOutputTokens: 64_000,
          },
        },
      }),
    });

    expect(events).toEqual([
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        messageId: "result-1",
        message: "FINAL_WITH_USAGE",
      },
      {
        type: "session_idle",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
      },
    ]);
  });
});
