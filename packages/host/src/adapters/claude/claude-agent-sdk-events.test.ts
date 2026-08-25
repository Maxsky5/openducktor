import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import {
  claudeSdkMessageFixture,
  claudeSdkMessageUuidFixture,
} from "./claude-agent-sdk-test-messages";

describe("handleClaudeSdkMessage assistant transcript events", () => {
  test("emits transcript retractions for Claude superseded assistant messages", () => {
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
        type: "assistant",
        uuid: "f3fd90b6-7503-4f6b-8322-9ebb0cd80fe5",
        session_id: "session-1",
        supersedes: [
          "9230f95a-2b26-4793-848d-1911ed890ca5",
          "9230f95a-2b26-4793-848d-1911ed890ca5",
          "bb446364-8a85-4d93-8e5c-dd06352c9362",
        ],
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "replacement" }],
        },
      }),
    });

    expect(events[0]).toEqual({
      type: "transcript_retracted",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:00.000Z",
      messageIds: ["9230f95a-2b26-4793-848d-1911ed890ca5", "bb446364-8a85-4d93-8e5c-dd06352c9362"],
    });
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: "assistant_message",
        messageId: "f3fd90b6-7503-4f6b-8322-9ebb0cd80fe5",
        message: "replacement",
      }),
    );
  });

  test("emits transcript retractions for Claude model refusal fallback retractions", () => {
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
        type: "system",
        subtype: "model_refusal_fallback",
        trigger: "refusal",
        direction: "retry",
        original_model: "claude-opus-4-5",
        fallback_model: "claude-sonnet-4-5",
        request_id: "req-1",
        content: "Retrying with fallback model.",
        uuid: "42b5bad4-ee24-401b-830c-ec2dce4d10b8",
        session_id: "session-1",
        retracted_message_uuids: [
          "9230f95a-2b26-4793-848d-1911ed890ca5",
          "9230f95a-2b26-4793-848d-1911ed890ca5",
          "f3fd90b6-7503-4f6b-8322-9ebb0cd80fe5",
        ],
      }),
    });

    expect(events).toContainEqual({
      type: "transcript_retracted",
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:00.000Z",
      messageIds: ["9230f95a-2b26-4793-848d-1911ed890ca5", "f3fd90b6-7503-4f6b-8322-9ebb0cd80fe5"],
    });
  });

  test("preserves assistant text and tool block order when Claude stops to use a tool", () => {
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
        type: "assistant",
        uuid: "9230f95a-2b26-4793-848d-1911ed890ca5",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "I will inspect the task first." },
            {
              type: "tool_use",
              id: "tool-1",
              name: "mcp__openducktor__odt_read_task",
              input: { taskId: "task-1" },
            },
            { type: "text", text: "Then I will inspect the plan." },
          ],
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "text",
          messageId: "9230f95a-2b26-4793-848d-1911ed890ca5",
          partId: "9230f95a-2b26-4793-848d-1911ed890ca5:text:0",
          text: "I will inspect the task first.",
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
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "text",
          messageId: "9230f95a-2b26-4793-848d-1911ed890ca5",
          partId: "9230f95a-2b26-4793-848d-1911ed890ca5:text:2",
          text: "Then I will inspect the plan.",
          completed: true,
        }),
      }),
    ]);
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
  });

  test("emits text-only Claude intermediate responses without finalizing them", () => {
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
        type: "assistant",
        uuid: "06f26c0a-9c7b-470c-8746-3e341dda066c",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "text", text: "I will inspect the task first." }],
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "text",
          messageId: "06f26c0a-9c7b-470c-8746-3e341dda066c",
          text: "I will inspect the task first.",
          completed: true,
        }),
      }),
    ]);
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
  });

  test("keeps assistant responses to peer turns intermediate", () => {
    const origins = [{ kind: "peer", from: "general-purpose", senderTaskId: "agent-1" }] as const;

    for (const [index, origin] of origins.entries()) {
      const events: AgentEvent[] = [];
      const session = createSession("running");
      session.activeSdkUserTurnCount = 1;
      session.pendingUserTurnCount = 1;
      session.acceptedUserMessages.push({});

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
          uuid: claudeSdkMessageUuidFixture(`non-human-user-${index}`),
          session_id: "session-1",
          parent_tool_use_id: null,
          message: { role: "user", content: "Runtime-generated input" },
          origin,
        }),
      });

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
          type: "assistant",
          uuid: claudeSdkMessageUuidFixture(`non-human-assistant-${index}`),
          session_id: "session-1",
          parent_tool_use_id: null,
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            stop_reason: "end_turn",
            content: [{ type: "text", text: `Runtime-generated response ${index}` }],
          },
        }),
      });

      handleClaudeSdkMessage({
        session,
        timestamp: "2026-06-25T20:00:02.000Z",
        modelSelection: (model) => ({
          providerId: "claude",
          modelId: model,
          runtimeKind: "claude",
        }),
        emit: (event) => events.push(event),
        message: claudeSdkMessageFixture({
          type: "result",
          subtype: "success",
          uuid: claudeSdkMessageUuidFixture(`non-human-result-${index}`),
          session_id: "session-1",
          is_error: false,
          duration_ms: 1_000,
          result: `Runtime-generated response ${index}`,
          stop_reason: "end_turn",
          terminal_reason: "completed",
          usage: { input_tokens: 1, output_tokens: 1 },
          origin,
        }),
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "assistant_part",
          part: expect.objectContaining({
            kind: "text",
            text: `Runtime-generated response ${index}`,
          }),
        }),
      );
      expect(events.some((event) => event.type === "assistant_message")).toBe(false);

      handleClaudeSdkMessage({
        session,
        timestamp: "2026-06-25T20:00:03.000Z",
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
          uuid: claudeSdkMessageUuidFixture(`peer-idle-${index}`),
          session_id: "session-1",
        }),
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session_idle",
        }),
      );
    }
  });

  test("finalizes the response to the last completed background task", () => {
    const events: AgentEvent[] = [];
    const session = createSession("running");
    session.activeBackgroundSubagentTaskIds = new Set(["task-1"]);
    session.activeSdkUserTurnCount = 1;
    session.pendingUserTurnCount = 1;
    session.acceptedUserMessages.push({});
    const input = {
      session,
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:00.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        uuid: "476c3da0-2559-4b52-8699-c061c1ad6226",
        session_id: "session-1",
      }),
    });
    handleClaudeSdkMessage({
      ...input,
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
    handleClaudeSdkMessage({
      ...input,
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
      ...input,
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

    expect(session.activeBackgroundSubagentTaskIds).toEqual(new Set());
    expect(
      events.filter(
        (event) =>
          event.type === "assistant_message" &&
          event.message === "All background reviews are complete.",
      ),
    ).toHaveLength(1);
  });

  test("lets SDK state settle the root while a nested background task is running", () => {
    const events: AgentEvent[] = [];
    const childSession = createSession("running");
    childSession.activeBackgroundSubagentTaskIds.add("nested-task-1");
    const session = {
      ...createSession("running"),
      subagentEventSessionsByToolUseId: new Map([["outer-agent-tool", childSession]]),
    };
    session.activeSdkUserTurnCount = 1;
    session.pendingUserTurnCount = 1;
    session.acceptedUserMessages.push({});
    const input = {
      session,
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:00.000Z",
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "7a44a127-4541-41a2-8608-5ccf96e86ef3",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: { role: "user", content: "Outer agent completed" },
        origin: { kind: "task-notification" },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "d377c478-99f5-48b5-8ad9-8526aa8a2d12",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "The outer agent is complete." }],
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:02.000Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "64bb56c2-31df-4cdb-8d84-2cc8a840eed5",
        session_id: "session-1",
        is_error: false,
        result: "The outer agent is complete.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 1, output_tokens: 1 },
        origin: { kind: "task-notification" },
      }),
    });

    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
    expect(session.activity).toBe("idle");
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(childSession.activeBackgroundSubagentTaskIds).toEqual(new Set(["nested-task-1"]));
  });

  test("renders terminal assistant text without closing the active SDK user turn", () => {
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
        type: "assistant",
        uuid: "9230f95a-2b26-4793-848d-1911ed890ca5",
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

    expect(session.activity).toBe("running");
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.pendingUserTurnCount).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_message",
        message: "Spec persisted.",
      }),
    ]);
    expect(session.lastAssistantText).toBe("Spec persisted.");
  });

  test("emits assistant snapshots without a stop reason as intermediate responses", () => {
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
        type: "assistant",
        uuid: "9230f95a-2b26-4793-848d-1911ed890ca5",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Draft snapshot" }],
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "text",
          messageId: "9230f95a-2b26-4793-848d-1911ed890ca5",
          text: "Draft snapshot",
          completed: true,
        }),
      }),
    ]);
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
  });

  test("emits non-final text parts for non-normal Claude stop reasons", () => {
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
        type: "assistant",
        uuid: "9230f95a-2b26-4793-848d-1911ed890ca5",
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

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "text",
          text: "Partial answer",
          completed: true,
        }),
      }),
    ]);
  });

  test("emits Claude partial text stream events as assistant deltas", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.acceptedUserMessages.push({});
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
        type: "stream_event",
        uuid: "b5d1f9c7-0707-4981-8daf-0a12edfcf6af",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Draft" },
        },
      }),
    });

    expect(events).toEqual([
      {
        type: "assistant_delta",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        channel: "text",
        messageId: "claude-stream:session-1:1:1:0",
        delta: "Draft",
      },
    ]);
  });

  test("replaces streamed assistant text with the authoritative assistant message id", () => {
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
        type: "stream_event",
        uuid: "b5d1f9c7-0707-4981-8daf-0a12edfcf6af",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Final answer" },
        },
      }),
    });

    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "e4ae11f2-86db-42bb-8867-2592ddbbcf9f",
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

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_delta",
        messageId: "claude-stream:session-1:1:1:0",
      }),
      expect.objectContaining({
        type: "assistant_message",
        messageId: "e4ae11f2-86db-42bb-8867-2592ddbbcf9f",
        message: "Final answer",
      }),
      expect.objectContaining({
        type: "transcript_retracted",
        messageIds: ["claude-stream:session-1:1:1:0"],
      }),
    ]);
  });

  test("preserves whitespace-only Claude text deltas", () => {
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

    for (const text of ["Hello", " ", "world"]) {
      handleClaudeSdkMessage({
        ...input,
        message: claudeSdkMessageFixture({
          type: "stream_event",
          uuid: claudeSdkMessageUuidFixture(`partial-event-${events.length}`),
          session_id: "session-1",
          parent_tool_use_id: null,
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text },
          },
        }),
      });
    }

    expect(
      events
        .filter((event) => event.type === "assistant_delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("Hello world");
  });

  test("uses distinct streamed assistant ids for multiple assistant messages in one turn", () => {
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
        type: "stream_event",
        uuid: "a0c39cdd-689b-4b8d-8cc8-f8ad2086ee65",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: { type: "message_start" },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "7bfcd7af-4861-4012-8dcd-4884c598d6cb",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "First draft" },
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "301bf08f-23c5-4c36-8057-ba638661910b",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "text", text: "First draft" }],
        },
      }),
    });

    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "08d7e85c-29cf-4d89-813f-bb75bc65caf2",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: { type: "message_start" },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "0ccfd682-b274-4d38-803a-21b90e8c45b3",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Second draft" },
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "9b5e0484-15a0-4db8-8191-d96800c2791a",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Second draft" }],
        },
      }),
    });

    const assistantTextMessageIds = events.flatMap((event) => {
      if (event.type === "assistant_delta" || event.type === "assistant_message") {
        return [event.messageId];
      }
      if (event.type === "assistant_part" && event.part.kind === "text") {
        return [event.part.messageId];
      }
      return [];
    });

    expect(assistantTextMessageIds).toEqual([
      "a0c39cdd-689b-4b8d-8cc8-f8ad2086ee65",
      "301bf08f-23c5-4c36-8057-ba638661910b",
      "08d7e85c-29cf-4d89-813f-bb75bc65caf2",
      "9b5e0484-15a0-4db8-8191-d96800c2791a",
    ]);
  });

  test("does not reuse streamed assistant ids when Claude omits message_start", () => {
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
        type: "stream_event",
        uuid: "7bfcd7af-4861-4012-8dcd-4884c598d6cb",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "First draft" },
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "301bf08f-23c5-4c36-8057-ba638661910b",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "First draft" },
            { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "pwd" } },
          ],
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "0ccfd682-b274-4d38-803a-21b90e8c45b3",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Second draft" },
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "9b5e0484-15a0-4db8-8191-d96800c2791a",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Second draft" }],
        },
      }),
    });

    const assistantTextMessageIds = events.flatMap((event) => {
      if (event.type === "assistant_delta" || event.type === "assistant_message") {
        return [event.messageId];
      }
      if (event.type === "assistant_part" && event.part.kind === "text") {
        return [event.part.messageId];
      }
      return [];
    });

    expect(assistantTextMessageIds).toEqual([
      "claude-stream:session-1:1:1:0",
      "301bf08f-23c5-4c36-8057-ba638661910b",
      "claude-stream:session-1:1:2:0",
      "9b5e0484-15a0-4db8-8191-d96800c2791a",
    ]);
  });

  test("finalizes multi-block streamed assistant text without leaving duplicate rows", () => {
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
        type: "stream_event",
        uuid: "a0c39cdd-689b-4b8d-8cc8-f8ad2086ee65",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: { type: "message_start" },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "7bfcd7af-4861-4012-8dcd-4884c598d6cb",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "First block" },
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "0ccfd682-b274-4d38-803a-21b90e8c45b3",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "Second block" },
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "e4ae11f2-86db-42bb-8867-2592ddbbcf9f",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "First block" },
            { type: "text", text: "Second block" },
          ],
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_delta",
        messageId: "a0c39cdd-689b-4b8d-8cc8-f8ad2086ee65",
        delta: "First block",
      }),
      expect.objectContaining({
        type: "assistant_delta",
        messageId: "a0c39cdd-689b-4b8d-8cc8-f8ad2086ee65",
        delta: "Second block",
      }),
      expect.objectContaining({
        type: "assistant_message",
        messageId: "e4ae11f2-86db-42bb-8867-2592ddbbcf9f",
        message: "First block\nSecond block",
      }),
      expect.objectContaining({
        type: "transcript_retracted",
        messageIds: ["a0c39cdd-689b-4b8d-8cc8-f8ad2086ee65"],
      }),
    ]);
  });

  test("keeps a tool pending while Claude streams its input JSON", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const baseInput = {
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
      ...baseInput,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "275e7ed5-998b-4e33-8ab6-daf07f7b2e6f",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: {},
          },
        },
      }),
    });

    handleClaudeSdkMessage({
      ...baseInput,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "12d101f2-8878-4cf7-84c1-3e332e6698a9",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "input_json_delta",
            partial_json: '{"command":"bun test"}',
          },
        },
      }),
    });

    handleClaudeSdkMessage({
      ...baseInput,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "e4ae11f2-86db-42bb-8867-2592ddbbcf9f",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "bun test" },
            },
          ],
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          messageId: "tool-1",
          partId: "tool-1",
          callId: "tool-1",
          tool: "Bash",
          status: "pending",
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          messageId: "tool-1",
          partId: "tool-1",
          callId: "tool-1",
          tool: "Bash",
          status: "pending",
        }),
      }),
    ]);
    expect(session.toolInputsByCallId.get("tool-1")).toEqual({ command: "bun test" });
  });
});
