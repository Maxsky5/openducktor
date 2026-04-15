import { describe, expect, test } from "bun:test";
import { createSessionEventBatcher, isImmediateSessionEvent } from "./session-event-batching";
import type { SessionEvent } from "./session-event-types";

describe("session-event-batching", () => {
  test("concatenates assistant deltas with the same message key before emitting", () => {
    const batcher = createSessionEventBatcher();
    const prepared = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_delta",
        sessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Hello",
        timestamp: "2026-02-22T08:00:01.000Z",
      },
      {
        type: "assistant_delta",
        sessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: " world",
        timestamp: "2026-02-22T08:00:02.000Z",
      },
    ] satisfies SessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "assistant_delta",
        sessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Hello world",
        timestamp: "2026-02-22T08:00:02.000Z",
      },
    ]);
  });

  test("drops streamed text events that are superseded by a final assistant message", () => {
    const batcher = createSessionEventBatcher();
    const prepared = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_delta",
        sessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Draft",
        timestamp: "2026-02-22T08:00:01.000Z",
      },
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
        part: {
          kind: "text",
          messageId: "assistant-1",
          partId: "text-1",
          text: "Draft refined",
          completed: false,
        },
      },
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.500Z",
        part: {
          kind: "reasoning",
          messageId: "assistant-1",
          partId: "reasoning-1",
          text: "Still visible",
          completed: false,
        },
      },
      {
        type: "assistant_message",
        sessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:03.000Z",
        message: "Final answer",
      },
    ] satisfies SessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.500Z",
        part: {
          kind: "reasoning",
          messageId: "assistant-1",
          partId: "reasoning-1",
          text: "Still visible",
          completed: false,
        },
      },
      {
        type: "assistant_message",
        sessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:03.000Z",
        message: "Final answer",
      },
    ]);
  });

  test("emits completed assistant parts immediately even inside the normal throttle window", () => {
    let now = 1_000;
    const batcher = createSessionEventBatcher({ nowMs: () => now });

    const first = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "bash",
          status: "running",
          input: { command: "pwd" },
        },
      },
    ] satisfies SessionEvent[]);

    now += 50;
    const second = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_part",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.050Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "bash",
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp/repo",
        },
      },
    ] satisfies SessionEvent[]);

    expect(first.readyEvents).toHaveLength(1);
    expect(second.readyEvents).toHaveLength(1);
    expect(second.deferredEvents).toHaveLength(0);
    expect(second.nextDelayMs).toBeNull();
  });

  test("reports the shortest remaining delay across deferred event keys", () => {
    let now = 1_000;
    const batcher = createSessionEventBatcher({ nowMs: () => now });

    const firstPrepared = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_message",
        sessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "First",
      },
      {
        type: "tool_call",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        call: {
          tool: "odt_set_plan",
          args: { taskId: "task-1", markdown: "# Plan" },
        },
      },
    ] satisfies SessionEvent[]);

    expect(firstPrepared.readyEvents).toHaveLength(2);

    now += 150;
    const prepared = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_message",
        sessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.150Z",
        message: "Second",
      },
      {
        type: "tool_call",
        sessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.150Z",
        call: {
          tool: "odt_set_plan",
          args: { taskId: "task-1", markdown: "# Plan" },
        },
      },
    ] satisfies SessionEvent[]);

    expect(prepared.readyEvents).toHaveLength(0);
    expect(prepared.deferredEvents).toHaveLength(2);
    expect(prepared.nextDelayMs).toBe(250);
  });

  test("classifies only configured session events as immediate", () => {
    expect(
      isImmediateSessionEvent({
        type: "user_message",
        sessionId: "session-1",
        messageId: "user-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "Continue",
        parts: [{ kind: "text", text: "Continue" }],
        state: "read",
      }),
    ).toBe(true);

    expect(
      isImmediateSessionEvent({
        type: "assistant_delta",
        sessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Hello",
        timestamp: "2026-02-22T08:00:01.000Z",
      }),
    ).toBe(false);
  });
});
