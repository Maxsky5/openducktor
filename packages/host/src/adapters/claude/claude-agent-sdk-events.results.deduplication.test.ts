import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

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
