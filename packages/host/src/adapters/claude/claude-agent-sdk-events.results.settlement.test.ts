import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import {
  claudeAcceptedUserMessageFixture,
  createEventTestSession as createSession,
} from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

const readSdkState = (session: ReturnType<typeof createSession>) => session.sdkState;

const idleTrace = () => {
  const events: AgentEvent[] = [];
  const session = createSession("idle");
  const send = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"]) =>
    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message,
    });
  return { events, send, session };
};

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
    expect(events.map((event) => event.type)).toEqual(["assistant_message", "session_idle"]);

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
    expect(events.map((event) => event.type)).toEqual(["assistant_message", "session_idle"]);
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
    expect(events.map((event) => event.type)).toEqual(["assistant_message", "session_idle"]);
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
    expect(events.map((event) => event.type)).toEqual(["assistant_message", "session_idle"]);
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
    expect(events.map((event) => event.type)).toEqual(["assistant_message"]);
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
    expect(events.map((event) => event.type)).toEqual(["assistant_message", "session_idle"]);
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

  test.each([
    { kind: "auto-continuation" as const },
    { kind: "channel" as const, server: "review-channel" },
    { kind: "coordinator" as const },
    { kind: "peer" as const, from: "teammate" },
  ])("keeps $kind wake-up work running through assistant output", (origin) => {
    const { events, send, session } = idleTrace();
    send(
      claudeSdkMessageFixture({
        type: "user",
        parent_tool_use_id: null,
        message: { role: "user", content: "Continue the check" },
        origin,
      }),
    );
    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(events[0]).toMatchObject({
      type: "session_status",
      status: { type: "busy", message: null },
    });

    send(
      claudeSdkMessageFixture({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: null,
          content: [{ type: "text", text: "Checking files" }],
        },
      }),
    );
    expect(session.activity).toBe("running");
    expect(events.some((event) => event.type === "session_idle")).toBe(false);

    send(
      claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Checks complete",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 1, output_tokens: 1 },
        origin,
      }),
    );
    expect(session.activity).toBe("idle");
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
  });

  test("starts a wake-up turn from an unattributed root user message", () => {
    const { events, send, session } = idleTrace();
    send(
      claudeSdkMessageFixture({
        type: "user",
        parent_tool_use_id: null,
        message: { role: "user", content: "Background check finished" },
      }),
    );

    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(events[0]).toMatchObject({
      type: "session_status",
      status: { type: "busy", message: null },
    });
  });

  test("starts a wake-up turn when assistant text streams without a user frame", () => {
    const { events, send, session } = idleTrace();
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "running",
      }),
    );
    expect(session.activity).toBe("idle");

    send(
      claudeSdkMessageFixture({
        type: "stream_event",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Checking files" },
        },
      }),
    );
    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(events.map((event) => event.type)).toEqual(["session_status", "assistant_delta"]);

    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
      }),
    );
    expect(session.activity).toBe("running");
    expect(events.filter((event) => event.type === "session_idle")).toEqual([]);

    send(
      claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Checks complete",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    expect(session.activity).toBe("idle");
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
  });

  test("starts a wake-up turn when its first output is a tool call", () => {
    const { events, send, session } = idleTrace();
    send(
      claudeSdkMessageFixture({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "a.ts" } }],
        },
      }),
    );

    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(events[0]).toMatchObject({
      type: "session_status",
      status: { type: "busy", message: null },
    });
    expect(events.some((event) => event.type === "assistant_part")).toBe(true);
  });

  test("does not start a turn from a non-query frame or a tool result", () => {
    const { events, send, session } = idleTrace();
    send(
      claudeSdkMessageFixture({
        type: "user",
        parent_tool_use_id: null,
        origin: { kind: "peer", from: "teammate" },
        shouldQuery: false,
        message: { role: "user", content: "Context for a later turn" },
      }),
    );
    send(
      claudeSdkMessageFixture({
        type: "user",
        parent_tool_use_id: "bash-1",
        origin: { kind: "task-notification" },
        tool_use_result: { type: "tool_result", tool_use_id: "bash-1", content: "Done" },
        message: { role: "user", content: [] },
      }),
    );

    expect(session.activity).toBe("idle");
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(events.filter((event) => event.type === "session_status")).toEqual([]);
  });

  test("settles a task-notification turn that runs while the host is idle", () => {
    const events: AgentEvent[] = [];
    const session = createSession("idle");
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
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "5a91c77d-22be-4340-8676-aa50b78359cc",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "Task completed" },
        origin: { kind: "task-notification" },
      }),
    });

    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_status",
        externalSessionId: "session-1",
        status: { type: "busy", message: null },
      }),
    ]);

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:02.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "31e408ec-4757-4238-87ab-e998e29e9c12",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "All background reviews are complete." }],
        },
      }),
    });
    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:03.000Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "e8e45018-5f3b-46ee-82da-0c358b384386",
        session_id: "session-1",
        is_error: false,
        result: "All background reviews are complete.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 1, output_tokens: 1 },
        origin: { kind: "task-notification" },
      }),
    });

    expect(session.activity).toBe("idle");
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        message: "All background reviews are complete.",
      }),
    );
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "session_idle",
        externalSessionId: "session-1",
      }),
    );
  });

  test("does not repeat the busy status when a wake-up turn starts during a live turn", () => {
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
        type: "user",
        uuid: "5a91c77d-22be-4340-8676-aa50b78359cc",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "Task completed" },
        origin: { kind: "task-notification" },
      }),
    });

    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(events.filter((event) => event.type === "session_status")).toEqual([]);
  });

  test("settles after a queued user turn races a task-notification turn", () => {
    const events: AgentEvent[] = [];
    const session = createSession("idle");
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
        type: "user",
        uuid: "5a91c77d-22be-4340-8676-aa50b78359cc",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "Task completed" },
        origin: { kind: "task-notification" },
      }),
    });
    expect(session.activeSdkUserTurnCount).toBe(1);
    // A local user send queues while the wake-up turn runs.
    session.pendingUserTurnCount = (session.pendingUserTurnCount ?? 0) + 1;

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "e8e45018-5f3b-46ee-82da-0c358b384386",
        session_id: "session-1",
        is_error: false,
        result: "Background review complete.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 1, output_tokens: 1 },
        origin: { kind: "task-notification" },
      }),
    });
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.activity).toBe("running");
    expect(events.filter((event) => event.type === "session_idle")).toEqual([]);

    // The queued send flushes and pushes the local turn.
    session.activeSdkUserTurnCount = 1;
    session.sdkState = "running";

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:02.000Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "f2a5e421-0b25-4de2-9d77-9d3a2f5d3c42",
        session_id: "session-1",
        is_error: false,
        result: "Queued user turn complete.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    expect(session.pendingUserTurnCount).toBe(0);

    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.activity).toBe("idle");
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
  });

  test("keeps a running wake-up turn when an idle frame arrives before the result", () => {
    const events: AgentEvent[] = [];
    const session = createSession("idle");
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
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "5a91c77d-22be-4340-8676-aa50b78359cc",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "Task completed" },
        origin: { kind: "task-notification" },
      }),
    });
    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:02.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "session_state_changed",
        state: "idle",
        uuid: "1d5aad36-4756-4086-8757-943eeef071df",
        session_id: "session-1",
      }),
    });
    expect(session.activity).toBe("running");
    expect(events.filter((event) => event.type === "session_idle")).toEqual([]);

    handleClaudeSdkMessage({
      ...commonInput,
      timestamp: "2026-06-25T20:00:03.000Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "e8e45018-5f3b-46ee-82da-0c358b384386",
        session_id: "session-1",
        is_error: false,
        result: "All background reviews are complete.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 1, output_tokens: 1 },
        origin: { kind: "task-notification" },
      }),
    });

    expect(session.activity).toBe("idle");
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
  });

  test("publishes the settle signal when a finalized result arrives while the host is idle", () => {
    const events: AgentEvent[] = [];
    const session = createSession("idle");

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
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    expect(session.activity).toBe("idle");
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
  });

  test("keeps the session running when a finalized result leaves pending input", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.pendingApprovals.set("approval-1", {
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        requestId: "approval-1",
        requestType: "runtime_tool",
        title: "Approve tool",
        tool: { name: "TestTool", input: {} },
        mutation: "unknown",
      },
      resolve: () => {},
    });

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
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    expect(session.activity).toBe("running");
    expect(events.filter((event) => event.type === "session_idle")).toEqual([]);
  });
});
