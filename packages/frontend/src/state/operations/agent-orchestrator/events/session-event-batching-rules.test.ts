import { describe, expect, test } from "bun:test";
import type { QueuedSessionEvent, SessionEventBatcher } from "./session-event-batching";
import { createSessionEventBatcher } from "./session-events-test-harness";

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

describe("agent-orchestrator session event batching rules", () => {
  test("centralizes assistant batch coalescing rules in one reducer", async () => {
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
        type: "session_status",
        externalSessionId: "session-1",
        status: { type: "busy", message: null },
        timestamp: "2026-02-22T08:00:01.500Z",
      },
      {
        type: "assistant_delta",
        externalSessionId: "session-1",
        channel: "text",
        messageId: "assistant-1",
        delta: " world",
        timestamp: "2026-02-22T08:00:02.000Z",
      },
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:03.000Z",
        part: {
          kind: "reasoning",
          messageId: "assistant-1",
          partId: "reasoning-1",
          text: "Draft reasoning",
          completed: false,
        },
      },
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:04.000Z",
        part: {
          kind: "reasoning",
          messageId: "assistant-1",
          partId: "reasoning-1",
          text: "Draft reasoning refined",
          completed: false,
        },
      },
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        message: "Final answer",
      },
    ] satisfies QueuedSessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "session_status",
        externalSessionId: "session-1",
        status: { type: "busy", message: null },
        timestamp: "2026-02-22T08:00:01.500Z",
      },
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:04.000Z",
        part: {
          kind: "reasoning",
          messageId: "assistant-1",
          partId: "reasoning-1",
          text: "Draft reasoning refined",
          completed: false,
        },
      },
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:05.000Z",
        message: "Final answer",
      },
    ]);
  });

  test("keeps per-type replacement behavior configurable inside the central reducer", async () => {
    const batcher = createSessionEventBatcher();
    const prepared = prepareQueuedEvents(batcher, [
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
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
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
      {
        type: "session_todos_updated",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:03.000Z",
        todos: [{ id: "todo-1", content: "Do it", status: "pending", priority: "high" }],
      },
      {
        type: "session_todos_updated",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:04.000Z",
        todos: [{ id: "todo-1", content: "Do it", status: "completed", priority: "high" }],
      },
    ] satisfies QueuedSessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
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
      {
        type: "session_todos_updated",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:04.000Z",
        todos: [{ id: "todo-1", content: "Do it", status: "completed", priority: "high" }],
      },
    ]);
  });

  test("preserves launch metadata when coalescing sparse subagent updates", () => {
    const batcher = createSessionEventBatcher();
    const prepared = prepareQueuedEvents(batcher, [
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        part: {
          kind: "subagent",
          messageId: "assistant-1",
          partId: "claude-subagent:task-1",
          correlationKey: "task-1",
          status: "running",
          agent: "Explore",
          prompt: "Inspect authentication",
          description: "Explore auth and project guidance",
          executionMode: "foreground",
          startedAtMs: 100,
        },
      },
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
        part: {
          kind: "subagent",
          messageId: "assistant-1",
          partId: "claude-subagent:task-1",
          correlationKey: "task-1",
          status: "running",
          agent: "Explore",
        },
      },
    ] satisfies QueuedSessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
        part: {
          kind: "subagent",
          messageId: "assistant-1",
          partId: "claude-subagent:task-1",
          correlationKey: "task-1",
          status: "running",
          agent: "Explore",
          prompt: "Inspect authentication",
          description: "Explore auth and project guidance",
          executionMode: "foreground",
          startedAtMs: 100,
        },
      },
    ]);
  });

  test("defers repeated final assistant message snapshots within the emit gate", async () => {
    let now = 1_000;
    const batcher = createSessionEventBatcher({
      nowMs: () => now,
    });
    const first = prepareQueuedEvents(batcher, [
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "Final answer 1",
      },
    ] satisfies QueuedSessionEvent[]);

    now += 100;
    const second = prepareQueuedEvents(batcher, [
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.100Z",
        message: "Final answer 2",
      },
    ] satisfies QueuedSessionEvent[]);

    expect(first.readyEvents).toHaveLength(1);
    expect(second.readyEvents).toHaveLength(0);
    expect(second.deferredEvents).toHaveLength(1);
  });

  test("gates assistant streaming by real elapsed time, not event timestamps", () => {
    let now = 10_000;
    const batcher = createSessionEventBatcher({
      nowMs: () => now,
    });

    const first = prepareQueuedEvents(batcher, [
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        part: {
          kind: "text",
          messageId: "assistant-1",
          partId: "text-1",
          text: "Hello",
          completed: false,
        },
      },
    ] satisfies QueuedSessionEvent[]);

    now += 100;
    const second = prepareQueuedEvents(batcher, [
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:20.000Z",
        part: {
          kind: "text",
          messageId: "assistant-1",
          partId: "text-1",
          text: "Hello again",
          completed: false,
        },
      },
    ] satisfies QueuedSessionEvent[]);

    expect(first.readyEvents).toHaveLength(1);
    expect(second.readyEvents).toHaveLength(0);
    expect(second.deferredEvents).toHaveLength(1);
    expect(second.nextDelayMs).toBe(400);
  });

  test("dedupes tool part updates in the central reducer", async () => {
    const batcher = createSessionEventBatcher();
    const prepared = prepareQueuedEvents(batcher, [
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "odt_set_spec",
          toolType: "workflow",
          status: "running",
          input: { taskId: "task-1", markdown: "# Spec" },
        },
      },
      {
        type: "assistant_part",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
        part: {
          kind: "tool",
          messageId: "assistant-1",
          partId: "tool-1",
          callId: "call-1",
          tool: "odt_set_spec",
          toolType: "workflow",
          status: "running",
          input: { taskId: "task-1", markdown: "# Spec" },
        },
      },
    ] satisfies QueuedSessionEvent[]);

    expect(prepared.readyEvents).toHaveLength(1);
    expect(prepared.readyEvents[0]?.type).toBe("assistant_part");
    expect(
      prepared.readyEvents[0]?.type === "assistant_part" ? prepared.readyEvents[0].part.kind : null,
    ).toBe("tool");
  });
});
