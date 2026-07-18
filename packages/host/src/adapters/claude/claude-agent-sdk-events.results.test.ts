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
          status: "running",
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

describe("handleClaudeSdkMessage result deduplication", () => {
  test("does not duplicate successful result text already emitted by assistant messages", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
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
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Spec persisted." }],
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
        result: "Spec persisted.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(session.activity).toBe("idle");
    expect(events.map((event) => event.type)).toEqual(["assistant_message", "session_idle"]);
  });

  test("does not duplicate successful result text already emitted by assistant text parts", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
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
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "Partial answer" }],
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
        result: "Partial answer",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual(["assistant_part", "session_idle"]);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "session_idle",
      }),
    );
    expect(session.activity).toBe("idle");
  });

  test("does not duplicate assistant text parts while earlier queued turns are completing", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.acceptedUserMessages.push(
      { messageId: "user-1", text: "First", timestamp: "2026-06-25T19:59:00.000Z" },
      { messageId: "user-2", text: "Second", timestamp: "2026-06-25T19:59:30.000Z" },
    );
    session.pendingUserTurnCount = 2;
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
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "First queued result" }],
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
        result: "First queued result",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual(["assistant_part"]);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.activity).toBe("running");
  });
});

describe("handleClaudeSdkMessage result settlement", () => {
  test("settles completed successful results immediately", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.pendingUserTurnCount = 1;
    session.sdkState = "running";
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
        is_error: false,
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 5, output_tokens: 7 },
        modelUsage: {
          "claude-sonnet-4-6": {
            contextWindow: 200_000,
            maxOutputTokens: 64_000,
          },
        },
      }),
    });

    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activity).toBe("idle");
    const sdkStateAfterCompletedResult = session.sdkState as
      | "idle"
      | "requires_action"
      | "running"
      | undefined;
    expect(sdkStateAfterCompletedResult).toBe("idle");
    expect(events.map((event) => event.type)).toEqual(["session_idle"]);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "session_idle",
      }),
    );

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "state-1",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("idle");
    expect(events.map((event) => event.type)).toEqual(["session_idle"]);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "session_idle",
      }),
    );
  });

  test("settles completed results even when SDK idle is absent", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
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
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    });

    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activity).toBe("idle");
    expect(session.sdkState).toBe("idle");
    expect(events.map((event) => event.type)).toEqual(["session_idle"]);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "session_idle",
      }),
    );
  });

  test("settles a completed result immediately when SDK idle arrived before the result", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
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
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "state-1",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("running");
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.sdkState).toBe("idle");
    expect(events).toEqual([]);

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    });

    expect(session.activity).toBe("idle");
    expect(session.pendingUserTurnCount).toBe(0);
    expect(events.map((event) => event.type)).toEqual(["session_idle"]);
  });

  test("emits repeated same-text result-only replies for separate user turns", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.acceptedUserMessages.push(
      { messageId: "user-1", text: "First", timestamp: "2026-06-25T19:59:00.000Z" },
      { messageId: "user-2", text: "Second", timestamp: "2026-06-25T19:59:30.000Z" },
    );
    session.pendingUserTurnCount = 2;

    const commonInput = {
      session,
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:00.000Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        is_error: false,
        result: "Done.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "result-2",
        session_id: "session-1",
        is_error: false,
        result: "Done.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    });

    expect(
      events.filter((event): event is Extract<AgentEvent, { type: "assistant_message" }> => {
        return event.type === "assistant_message";
      }),
    ).toEqual([
      expect.objectContaining({ messageId: "result-1", message: "Done." }),
      expect.objectContaining({ messageId: "result-2", message: "Done." }),
    ]);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activity).toBe("idle");

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:02.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "state-1",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("idle");
    expect(session.pendingUserTurnCount).toBe(0);
  });

  test("keeps completed results running while later queued user turns are pending", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
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
        terminal_reason: "completed",
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    });

    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.activity).toBe("running");
    expect(events.map((event) => event.type)).toEqual([]);
  });

  test("settles background-requested Claude results on the next SDK idle event", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.sdkState = "running";
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
        type: "result",
        subtype: "success",
        is_error: false,
        terminal_reason: "background_requested",
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    });

    expect(session.activity).toBe("running");
    expect(session.pendingUserTurnCount).toBe(0);
    expect(events.map((event) => event.type)).toEqual([]);

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "state-1",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("idle");
    expect(session.pendingUserTurnCount).toBe(0);
    expect(events.map((event) => event.type)).toEqual(["session_idle"]);
  });

  test("settles tool-deferred Claude results on the next SDK idle event", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.sdkState = "running";
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
        type: "result",
        subtype: "success",
        is_error: false,
        terminal_reason: "tool_deferred",
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    });

    expect(session.activity).toBe("running");
    expect(session.pendingUserTurnCount).toBe(0);
    expect(events.map((event) => event.type)).toEqual([]);

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "state-1",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("idle");
    expect(session.pendingUserTurnCount).toBe(0);
    expect(events.map((event) => event.type)).toEqual(["session_idle"]);
  });
});

describe("handleClaudeSdkMessage failed results", () => {
  test("reports failed Claude results and settles the session idle", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
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
        subtype: "error_during_execution",
        is_error: true,
        errors: ["API Error: an image in the conversation could not be processed."],
        usage: { input_tokens: 5, output_tokens: 0 },
      }),
    });

    expect(session.activity).toBe("idle");
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_error",
        message: "API Error: an image in the conversation could not be processed.",
      }),
      expect.objectContaining({
        type: "session_idle",
        externalSessionId: "session-1",
      }),
    ]);

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "state-1",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("idle");
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_error",
        message: "API Error: an image in the conversation could not be processed.",
      }),
      expect.objectContaining({
        type: "session_idle",
        externalSessionId: "session-1",
      }),
    ]);
  });

  test("reports terminal Claude image errors and settles the session idle", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");

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
        terminal_reason: "image_error",
        result: "API Error: an image in the conversation could not be processed and was removed.",
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    });

    expect(session.activity).toBe("idle");
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_error",
        message: "API Error: an image in the conversation could not be processed and was removed.",
      }),
      expect.objectContaining({
        type: "session_idle",
        externalSessionId: "session-1",
      }),
    ]);

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "state-1",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("idle");
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_error",
        message: "API Error: an image in the conversation could not be processed and was removed.",
      }),
      expect.objectContaining({
        type: "session_idle",
        externalSessionId: "session-1",
      }),
    ]);
  });

  test("keeps sessions running when Claude result stops for tool use", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
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
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    });

    expect(session.activity).toBe("running");
    expect(events.map((event) => event.type)).toEqual([]);

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "state-1",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("running");
    expect(session.pendingUserTurnCount).toBe(1);
    expect(events.map((event) => event.type)).toEqual([]);
  });
});
