import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { subscribeOpencodeEvents } from "./event-stream";
import type { SessionInput, SessionRecord } from "./types";

const makeClientWithEvents = (events: Event[]): OpencodeClient => {
  return {
    event: {
      subscribe: async () => {
        async function* iterator(): AsyncGenerator<Event> {
          for (const event of events) {
            yield event;
          }
        }
        return { stream: iterator() };
      },
    },
  } as unknown as OpencodeClient;
};

const makeSessionInput = (): SessionInput => ({
  sessionId: "local-session-1",
  repoPath: "/repo",
  workingDirectory: "/repo",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  systemPrompt: "System prompt",
  baseUrl: "http://127.0.0.1:12345",
});

const makeSessionRecord = (client: OpencodeClient): SessionRecord => ({
  summary: {
    sessionId: "local-session-1",
    externalSessionId: "external-session-1",
    role: "spec",
    scenario: "spec_initial",
    startedAt: "2026-02-22T12:00:00.000Z",
    status: "running",
  },
  input: makeSessionInput(),
  client,
  externalSessionId: "external-session-1",
  streamAbortController: new AbortController(),
  streamDone: Promise.resolve(),
  emittedAssistantMessageIds: new Set<string>(),
});

describe("event-stream", () => {
  test("deduplicates assistant_message across repeated message.updated events", async () => {
    const assistantEvent = {
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-message-1",
          role: "assistant",
          sessionID: "external-session-1",
          tokens: {
            input: 100,
            output: 20,
          },
          time: {
            completed: 1,
          },
          finish: "stop",
        },
        parts: [
          {
            id: "reasoning-1",
            sessionID: "external-session-1",
            messageID: "assistant-message-1",
            type: "reasoning",
            text: "Plan",
            time: { start: 1, end: 2 },
          },
          {
            id: "text-1",
            sessionID: "external-session-1",
            messageID: "assistant-message-1",
            type: "text",
            text: "Done",
            time: { start: 1, end: 2 },
          },
        ],
      },
    } as unknown as Event;

    const client = makeClientWithEvents([assistantEvent, assistantEvent]);
    const emitted: AgentEvent[] = [];
    const sessionRecord = makeSessionRecord(client);

    await subscribeOpencodeEvents({
      context: {
        sessionId: "local-session-1",
        externalSessionId: "external-session-1",
        input: makeSessionInput(),
      },
      client,
      controller: new AbortController(),
      now: () => "2026-02-22T12:00:00.000Z",
      emit: (_sessionId, event) => {
        emitted.push(event);
      },
      getSession: () => sessionRecord,
    });

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0].totalTokens).toBe(120);
    expect(emitted.some((event) => event.type === "assistant_part")).toBe(true);
  });

  test("normalizes todo.updated and ignores unrelated sessions", async () => {
    const client = makeClientWithEvents([
      {
        type: "todo.updated",
        properties: {
          sessionID: "external-other-session",
          todos: [{ content: "ignored" }],
        },
      } as unknown as Event,
      {
        type: "todo.updated",
        properties: {
          sessionID: "external-session-1",
          todos: [
            {
              content: "Implement tests",
              status: "active",
            },
          ],
        },
      } as unknown as Event,
    ]);

    const emitted: AgentEvent[] = [];
    const sessionRecord = makeSessionRecord(client);

    await subscribeOpencodeEvents({
      context: {
        sessionId: "local-session-1",
        externalSessionId: "external-session-1",
        input: makeSessionInput(),
      },
      client,
      controller: new AbortController(),
      now: () => "2026-02-22T12:00:00.000Z",
      emit: (_sessionId, event) => {
        emitted.push(event);
      },
      getSession: () => sessionRecord,
    });

    const todoEvents = emitted.filter((event) => event.type === "session_todos_updated");
    expect(todoEvents).toHaveLength(1);
    if (todoEvents[0]?.type !== "session_todos_updated") {
      throw new Error("Expected session_todos_updated event");
    }
    expect(todoEvents[0].todos).toEqual([
      {
        id: "todo:0",
        content: "Implement tests",
        status: "in_progress",
        priority: "medium",
      },
    ]);
  });
});
