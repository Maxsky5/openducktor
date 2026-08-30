import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import {
  claudeAcceptedUserMessageFixture,
  createEventTestSession as createSession,
} from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

const readSdkState = (session: ReturnType<typeof createSession>) => session.sdkState;

describe("handleClaudeSdkMessage result settlement", () => {
  test("marks the parent idle when its completed result arrives", () => {
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
    expect(readSdkState(session)).toBe("idle");
    expect(events.map((event) => event.type)).toEqual(["session_idle"]);

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "1d5aad36-4756-4086-8757-943eeef071df",
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

  test("marks the parent idle while its background subagent remains active", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.pendingUserTurnCount = 1;
    session.sdkState = "running";
    session.activeBackgroundSubagentTaskIds.add("background-task-1");

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
    expect(readSdkState(session)).toBe("idle");
    expect(events.map((event) => event.type)).toEqual(["session_idle"]);
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
        uuid: "1d5aad36-4756-4086-8757-943eeef071df",
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
      claudeAcceptedUserMessageFixture({
        messageId: "user-1",
        text: "First",
        timestamp: "2026-06-25T19:59:00.000Z",
      }),
      claudeAcceptedUserMessageFixture({
        messageId: "user-2",
        text: "Second",
        timestamp: "2026-06-25T19:59:30.000Z",
      }),
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
        uuid: "fb14f885-bbdb-4906-876f-87ec1c4c86c8",
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
        uuid: "332ac88a-b771-4d00-843f-817399df578b",
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
      expect.objectContaining({
        messageId: "fb14f885-bbdb-4906-876f-87ec1c4c86c8",
        message: "Done.",
      }),
      expect.objectContaining({
        messageId: "332ac88a-b771-4d00-843f-817399df578b",
        message: "Done.",
      }),
    ]);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activity).toBe("idle");
    expect(session.pendingUserTurnCount).toBe(0);
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
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

  test("marks the parent idle when Claude waits for background work", () => {
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
        stop_reason: "tool_use",
        terminal_reason: "background_requested",
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    });

    expect(session.activity).toBe("idle");
    expect(readSdkState(session)).toBe("idle");
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
        uuid: "1d5aad36-4756-4086-8757-943eeef071df",
        session_id: "session-1",
      }),
    });

    expect(session.activity).toBe("idle");
    expect(session.pendingUserTurnCount).toBe(0);
    expect(events.map((event) => event.type)).toEqual(["session_idle"]);
  });
});
