import { describe, expect, test } from "bun:test";
import {
  closesQueuedSessionEvents,
  createSessionEventBatcher,
  isImmediateSessionEvent,
  type QueuedSessionEvent,
  type SessionEventBatcher,
} from "./session-event-batching";

const prepareQueuedEvents = (batcher: SessionEventBatcher, events: QueuedSessionEvent[]) => {
  const prepared = batcher.prepareQueuedSessionEvents(
    events.map((event) => ({
      event,
      routeKey: event.externalSessionId,
    })),
  );
  return {
    readyEvents: prepared.readyEvents.map((item) => item.event),
    deferredEvents: prepared.deferredEvents.map((item) => item.event),
    nextDelayMs: prepared.nextDelayMs,
  };
};

describe("session-event-batching", () => {
  test("concatenates assistant deltas with the same message key before emitting", async () => {
    const batcher = createSessionEventBatcher();
    const prepared = prepareQueuedEvents(batcher, [
      {
        type: "assistant_delta",
        externalSessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Hello",
        timestamp: "2026-02-22T08:00:01.000Z",
      },
      {
        type: "assistant_delta",
        externalSessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: " world",
        timestamp: "2026-02-22T08:00:02.000Z",
      },
    ] satisfies QueuedSessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "assistant_delta",
        externalSessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Hello world",
        timestamp: "2026-02-22T08:00:02.000Z",
      },
    ]);
  });

  test("drops streamed text events that are superseded by a final assistant message", async () => {
    const batcher = createSessionEventBatcher();
    const prepared = prepareQueuedEvents(batcher, [
      {
        type: "assistant_delta",
        externalSessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Draft",
        timestamp: "2026-02-22T08:00:01.000Z",
      },
      {
        type: "assistant_part",
        externalSessionId: "session-1",
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
        externalSessionId: "session-1",
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
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:03.000Z",
        message: "Final answer",
      },
    ] satisfies QueuedSessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "assistant_part",
        externalSessionId: "session-1",
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
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:03.000Z",
        message: "Final answer",
      },
    ]);
  });

  test("emits completed assistant parts immediately even inside the normal throttle window", async () => {
    let now = 1_000;
    const batcher = createSessionEventBatcher({ nowMs: () => now });

    const first = prepareQueuedEvents(batcher, [
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "bash",
          toolType: "bash",
          status: "running",
          input: { command: "pwd" },
        },
      },
    ] satisfies QueuedSessionEvent[]);

    now += 50;
    const second = prepareQueuedEvents(batcher, [
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.050Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "bash",
          toolType: "bash",
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp/repo",
        },
      },
    ] satisfies QueuedSessionEvent[]);

    expect(first.readyEvents).toHaveLength(1);
    expect(second.readyEvents).toHaveLength(1);
    expect(second.deferredEvents).toHaveLength(0);
    expect(second.nextDelayMs).toBeNull();
  });

  test("reports the shortest remaining delay across deferred event keys", async () => {
    let now = 1_000;
    const batcher = createSessionEventBatcher({ nowMs: () => now });

    const firstPrepared = prepareQueuedEvents(batcher, [
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "First",
      },
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "odt_set_plan",
          toolType: "workflow",
          status: "running",
          input: { taskId: "task-1", markdown: "# Plan" },
        },
      },
    ] satisfies QueuedSessionEvent[]);

    expect(firstPrepared.readyEvents).toHaveLength(2);

    now += 150;
    const prepared = prepareQueuedEvents(batcher, [
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.150Z",
        message: "Second",
      },
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.150Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "odt_set_plan",
          toolType: "workflow",
          status: "running",
          input: { taskId: "task-1", markdown: "# Plan" },
        },
      },
    ] satisfies QueuedSessionEvent[]);

    expect(prepared.readyEvents).toHaveLength(0);
    expect(prepared.deferredEvents).toHaveLength(2);
    expect(prepared.nextDelayMs).toBe(250);
  });

  test("classifies only configured session events as immediate", async () => {
    expect(
      isImmediateSessionEvent({
        type: "user_message",
        externalSessionId: "session-1",
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
        externalSessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: "Hello",
        timestamp: "2026-02-22T08:00:01.000Z",
      }),
    ).toBe(false);
  });

  test("classifies turn-closing immediate events as queued-event boundaries", async () => {
    expect(
      closesQueuedSessionEvents({
        type: "session_idle",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
      }),
    ).toBe(true);
    expect(
      closesQueuedSessionEvents({
        type: "session_finished",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "done",
      }),
    ).toBe(true);
    expect(
      closesQueuedSessionEvents({
        type: "session_error",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "failed",
      }),
    ).toBe(true);
    expect(
      closesQueuedSessionEvents({
        type: "user_message",
        externalSessionId: "session-1",
        messageId: "user-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "Continue",
        parts: [{ kind: "text", text: "Continue" }],
        state: "read",
      }),
    ).toBe(false);
  });
});
