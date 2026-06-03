import { describe, expect, test } from "bun:test";
import type { Event } from "@opencode-ai/sdk/v2";
import type { AgentEvent } from "@openducktor/core";
import {
  flushAsync,
  makeMockClient,
  OpencodeSdkAdapter,
  startDefaultSession,
} from "./test-support";

describe("OpencodeSdkAdapter event stream", () => {
  test("maps message.updated events into assistant parts and assistant message", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            tokens: {
              input: 1_200,
              output: 300,
              reasoning: 90,
            },
            time: {
              completed: Date.parse("2026-02-17T12:00:05Z"),
            },
            finish: "stop",
          },
          parts: [
            {
              id: "reason-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "reasoning",
              text: "Reasoning trace",
              time: { start: Date.now(), end: Date.now() },
            },
            {
              id: "text-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "text",
              text: "Assistant output",
              time: { start: Date.now(), end: Date.now() },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    const partEvents = events.filter((entry) => entry.type === "assistant_part");
    const messageEvents = events.filter((entry) => entry.type === "assistant_message");

    expect(partEvents.length).toBeGreaterThanOrEqual(2);
    expect(messageEvents).toHaveLength(1);
    expect(messageEvents[0]).toMatchObject({
      type: "assistant_message",
      messageId: "assistant-1",
      message: "Assistant output",
      totalTokens: 1_590,
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "Hephaestus",
        variant: "high",
      },
    });
  });

  test("synthesizes session_idle from terminal assistant completion when no idle event follows", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-terminal-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            finish: "stop",
            time: {
              created: Date.parse("2026-02-17T12:00:03Z"),
              completed: Date.parse("2026-02-17T12:00:05Z"),
            },
          },
          parts: [
            {
              id: "text-terminal-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-terminal-1",
              type: "text",
              text: "Done",
              time: { start: 1, end: 1 },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    const idleEvents = events.filter((entry) => entry.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("maps terminal assistant metadata onto previously streamed text parts", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-text-2",
            sessionID: "session-opencode-1",
            messageID: "assistant-2",
            type: "text",
            text: "All done",
            time: { start: 1, end: 1 },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-2",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            agent: "Hephaestus",
            variant: "max",
            finish: "stop",
            tokens: {
              input: 8,
              output: 4,
            },
            time: {
              created: Date.parse("2026-02-17T12:00:06Z"),
              completed: Date.parse("2026-02-17T12:00:08Z"),
            },
          },
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    const assistantMessages = events.filter((entry) => entry.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      type: "assistant_message",
      messageId: "assistant-2",
      message: "All done",
      totalTokens: 12,
      model: {
        providerId: "anthropic",
        modelId: "claude-sonnet",
        profileId: "Hephaestus",
        variant: "max",
      },
    });
  });

  test("does not re-emit assistant streaming events after idle is already preserved", async () => {
    const streamEvents: Event[] = [
      {
        type: "session.status",
        properties: {
          sessionID: "session-opencode-1",
          status: {
            type: "idle",
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-idle-preserved-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            finish: "stop",
            time: {
              created: Date.parse("2026-02-17T12:00:06Z"),
              completed: Date.parse("2026-02-17T12:00:08Z"),
            },
          },
          parts: [
            {
              id: "text-idle-preserved-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-idle-preserved-1",
              type: "text",
              text: "All done",
              time: { start: 1, end: 1 },
            },
          ],
        },
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "session-opencode-1",
          partID: "text-idle-preserved-1",
          messageID: "assistant-idle-preserved-1",
          field: "text",
          delta: " later",
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    expect(events.filter((entry) => entry.type === "session_status")).toHaveLength(1);
    expect(events.filter((entry) => entry.type === "assistant_message")).toHaveLength(1);
    expect(events.filter((entry) => entry.type === "assistant_part")).toHaveLength(0);
    expect(events.filter((entry) => entry.type === "assistant_delta")).toHaveLength(0);
    expect(events.filter((entry) => entry.type === "session_idle")).toHaveLength(0);
  });

  test("emits the final assistant message when idle-preserved parts arrive after terminal metadata", async () => {
    const streamEvents: Event[] = [
      {
        type: "session.status",
        properties: {
          sessionID: "session-opencode-1",
          status: {
            type: "idle",
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-idle-late-part-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            finish: "stop",
            time: {
              created: Date.parse("2026-02-17T12:00:06Z"),
              completed: Date.parse("2026-02-17T12:00:08Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-idle-late-part-1",
            sessionID: "session-opencode-1",
            messageID: "assistant-idle-late-part-1",
            type: "text",
            text: "Recovered final output",
            time: { start: 1, end: 1 },
          },
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    expect(events.filter((entry) => entry.type === "session_status")).toHaveLength(1);
    expect(events.filter((entry) => entry.type === "assistant_part")).toHaveLength(0);
    expect(events.filter((entry) => entry.type === "assistant_delta")).toHaveLength(0);

    const assistantMessages = events.filter((entry) => entry.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0].message).toBe("Recovered final output");
    expect(events.filter((entry) => entry.type === "session_idle")).toHaveLength(0);
  });

  test("does not finalize previously streamed assistant text without a stop signal", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-text-3",
            sessionID: "session-opencode-1",
            messageID: "assistant-3",
            type: "text",
            text: "Still thinking",
            time: { start: 1, end: 1 },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-3",
            role: "assistant",
            sessionID: "session-opencode-1",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            agent: "Hephaestus",
            variant: "max",
            tokens: {
              input: 8,
              output: 4,
            },
            time: {
              created: Date.parse("2026-02-17T12:00:06Z"),
              completed: Date.parse("2026-02-17T12:00:08Z"),
            },
          },
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({ streamEvents });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    expect(events.some((entry) => entry.type === "assistant_message")).toBe(false);
    expect(events.some((entry) => entry.type === "session_idle")).toBe(false);
  });

  test("maps acknowledged user message.updated events into user_message", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-1",
            role: "user",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            text: "Generate the pull request",
            time: {
              created: Date.parse("2026-02-17T12:00:04Z"),
            },
          },
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    const userEvents = events.filter((entry) => entry.type === "user_message");
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0]).toMatchObject({
      type: "user_message",
      timestamp: "2026-02-17T12:00:04.000Z",
      messageId: "user-1",
      message: "Generate the pull request",
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "Hephaestus",
        variant: "high",
      },
    });
  });

  test("maps user message parts into user_message when message.updated omits text", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-user-2",
            sessionID: "session-opencode-1",
            messageID: "user-2",
            type: "text",
            text: "Generate the pull request",
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-2",
            role: "user",
            sessionID: "session-opencode-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            time: {
              created: Date.parse("2026-02-17T12:00:05Z"),
            },
          },
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    const userEvents = events.filter((entry) => entry.type === "user_message");
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0]).toMatchObject({
      type: "user_message",
      timestamp: "2026-02-17T12:00:05.000Z",
      messageId: "user-2",
      message: "Generate the pull request",
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "Hephaestus",
        variant: "high",
      },
    });
  });

  test("includes step-finish total tokens on assistant part events", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
          },
          parts: [
            {
              id: "step-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              type: "step-finish",
              reason: "tool-calls",
              tokens: {
                input: 898,
                output: 245,
                reasoning: 0,
                cache: {
                  read: 0,
                  write: 33_879,
                },
              },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    expect(events).toContainEqual({
      type: "assistant_part",
      externalSessionId: "session-opencode-1",
      timestamp: "2026-02-17T12:00:00Z",
      part: {
        kind: "step",
        messageId: "assistant-1",
        partId: "step-1",
        phase: "finish",
        reason: "tool-calls",
        totalTokens: 35_022,
      },
    });
  });

  test("maps completed MCP tool part with isError=true as error status", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            time: {
              completed: Date.parse("2026-02-17T12:00:05Z"),
            },
            finish: "tool-calls",
          },
          parts: [
            {
              id: "tool-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              callID: "call-1",
              type: "tool",
              tool: "openducktor_odt_set_spec",
              state: {
                status: "completed",
                input: { taskId: "facebook-oauth" },
                output: {
                  content: [{ type: "text", text: "Task not found: facebook-oauth" }],
                  isError: true,
                },
              },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    const toolPartEvent = events.find((entry) => {
      if (entry.type !== "assistant_part") {
        return false;
      }
      const part = entry.part;
      return part.kind === "tool";
    });

    expect(toolPartEvent).toBeDefined();
    if (toolPartEvent?.type !== "assistant_part" || toolPartEvent.part.kind !== "tool") {
      throw new Error("Expected tool part event");
    }
    expect(toolPartEvent.part.status).toBe("error");
    expect(toolPartEvent.part.error).toContain("Task not found");
  });

  test("maps flattened MCP tool error JSON output as error status", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
            time: {
              completed: Date.parse("2026-02-17T12:00:05Z"),
            },
            finish: "tool-calls",
          },
          parts: [
            {
              id: "tool-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              callID: "call-1",
              type: "tool",
              tool: "openducktor_odt_set_plan",
              state: {
                status: "completed",
                input: { taskId: "facebook-oauth" },
                output: JSON.stringify(
                  {
                    ok: false,
                    error: {
                      code: "ODT_TOOL_EXECUTION_ERROR",
                      message: "Only epics can receive subtask proposals during planning.",
                    },
                  },
                  null,
                  2,
                ),
              },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "planner");
    await flushAsync();

    const toolPartEvent = events.find((entry) => {
      if (entry.type !== "assistant_part") {
        return false;
      }
      const part = entry.part;
      return part.kind === "tool";
    });

    expect(toolPartEvent).toBeDefined();
    if (toolPartEvent?.type !== "assistant_part" || toolPartEvent.part.kind !== "tool") {
      throw new Error("Expected tool part event");
    }

    expect(toolPartEvent.part.status).toBe("error");
    expect(toolPartEvent.part.error).toContain(
      "Only epics can receive subtask proposals during planning.",
    );
  });

  test("maps todowrite tool part with ended timing to completed even when status is pending", async () => {
    const streamEvents: Event[] = [
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "session-opencode-1",
          },
          parts: [
            {
              id: "tool-1",
              sessionID: "session-opencode-1",
              messageID: "assistant-1",
              callID: "call-1",
              type: "tool",
              tool: "todowrite",
              state: {
                status: "pending",
                input: {
                  todos: [
                    {
                      id: "todo-1",
                      content: "A",
                    },
                  ],
                },
                time: {
                  start: 100,
                  end: 175,
                },
              },
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    const toolPartEvent = events.find((entry) => {
      if (entry.type !== "assistant_part") {
        return false;
      }
      return entry.part.kind === "tool" && entry.part.tool === "todowrite";
    });

    expect(toolPartEvent).toBeDefined();
    if (toolPartEvent?.type !== "assistant_part" || toolPartEvent.part.kind !== "tool") {
      throw new Error("Expected todowrite tool part event");
    }

    expect(toolPartEvent.part.status).toBe("completed");
    expect(toolPartEvent.part.startedAtMs).toBe(100);
    expect(toolPartEvent.part.endedAtMs).toBe(175);
  });

  test("maps todo.updated events into session_todos_updated", async () => {
    const streamEvents: Event[] = [
      {
        type: "todo.updated",
        properties: {
          sessionID: "session-opencode-1",
          todos: [
            {
              id: "todo-1",
              content: "Inspect auth flow",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "todo-2",
              content: "Write spec",
              status: "completed",
              priority: "medium",
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    const todoEvent = events.find((entry) => entry.type === "session_todos_updated");
    expect(todoEvent).toBeDefined();
    if (todoEvent?.type !== "session_todos_updated") {
      throw new Error("Expected session_todos_updated event");
    }
    expect(todoEvent.todos).toEqual([
      {
        id: "todo-1",
        content: "Inspect auth flow",
        status: "in_progress",
        priority: "high",
      },
      {
        id: "todo-2",
        content: "Write spec",
        status: "completed",
        priority: "medium",
      },
    ]);
  });

  test("maps todo.updated events with missing id/status aliases", async () => {
    const streamEvents: Event[] = [
      {
        type: "todo.updated",
        properties: {
          sessionID: "session-opencode-1",
          todos: [
            {
              content: "First",
              status: "active",
              priority: "low",
            },
            {
              text: "Second",
              completed: true,
            },
          ],
        },
      } as unknown as Event,
    ];

    const mock = makeMockClient({
      streamEvents,
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: AgentEvent[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => {
      events.push(event);
    });

    await startDefaultSession(adapter, "spec");
    await flushAsync();

    const todoEvent = events.find((entry) => entry.type === "session_todos_updated");
    expect(todoEvent).toBeDefined();
    if (todoEvent?.type !== "session_todos_updated") {
      throw new Error("Expected session_todos_updated event");
    }
    expect(todoEvent.todos).toEqual([
      {
        id: "todo:0",
        content: "First",
        status: "in_progress",
        priority: "low",
      },
      {
        id: "todo:1",
        content: "Second",
        status: "completed",
        priority: "medium",
      },
    ]);
  });
});
