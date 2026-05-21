import { describe, expect, test } from "bun:test";
import { createSessionEventBatcher, type SessionEvent } from "./session-events-test-harness";

describe("agent-orchestrator session event batching rules", () => {
  test("centralizes assistant batch coalescing rules in one reducer", () => {
    const batcher = createSessionEventBatcher();
    const prepared = batcher.prepareQueuedSessionEvents([
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
        status: { type: "busy" },
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
    ] satisfies SessionEvent[]);

    expect(prepared.readyEvents).toEqual([
      {
        type: "session_status",
        externalSessionId: "session-1",
        status: { type: "busy" },
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

  test("keeps per-type replacement behavior configurable inside the central reducer", () => {
    const batcher = createSessionEventBatcher();
    const prepared = batcher.prepareQueuedSessionEvents([
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
    ] satisfies SessionEvent[]);

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

  test("defers repeated final assistant message snapshots within the emit gate", () => {
    let now = 1_000;
    const batcher = createSessionEventBatcher({
      nowMs: () => now,
    });
    const first = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        message: "Final answer 1",
      },
    ] satisfies SessionEvent[]);

    now += 100;
    const second = batcher.prepareQueuedSessionEvents([
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        messageId: "assistant-1",
        timestamp: "2026-02-22T08:00:01.100Z",
        message: "Final answer 2",
      },
    ] satisfies SessionEvent[]);

    expect(first.readyEvents).toHaveLength(1);
    expect(second.readyEvents).toHaveLength(0);
    expect(second.deferredEvents).toHaveLength(1);
  });

  test("gates assistant streaming by real elapsed time, not event timestamps", () => {
    let now = 10_000;
    const batcher = createSessionEventBatcher({
      nowMs: () => now,
    });

    const first = batcher.prepareQueuedSessionEvents([
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
    ] satisfies SessionEvent[]);

    now += 100;
    const second = batcher.prepareQueuedSessionEvents([
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
    ] satisfies SessionEvent[]);

    expect(first.readyEvents).toHaveLength(1);
    expect(second.readyEvents).toHaveLength(0);
    expect(second.deferredEvents).toHaveLength(1);
    expect(second.nextDelayMs).toBe(400);
  });

  test("dedupes identical tool events in the central reducer", () => {
    const batcher = createSessionEventBatcher();
    const prepared = batcher.prepareQueuedSessionEvents([
      {
        type: "tool_call",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:01.000Z",
        call: {
          tool: "odt_set_spec",
          args: {
            taskId: "task-1",
            markdown: "# Spec",
          },
        },
      },
      {
        type: "tool_call",
        externalSessionId: "session-1",
        timestamp: "2026-02-22T08:00:02.000Z",
        call: {
          tool: "odt_set_spec",
          args: {
            taskId: "task-1",
            markdown: "# Spec",
          },
        },
      },
    ] satisfies SessionEvent[]);

    expect(prepared.readyEvents).toHaveLength(1);
    expect(prepared.readyEvents[0]?.type).toBe("tool_call");
  });
});
