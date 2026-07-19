import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

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
