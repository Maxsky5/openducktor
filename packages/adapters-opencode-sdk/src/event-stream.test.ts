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

const runEventStream = async (events: Event[]): Promise<AgentEvent[]> => {
  const client = makeClientWithEvents(events);
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

  return emitted;
};

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

  test("forwards every raw sdk event to logEvent before relevance filtering", async () => {
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
          todos: [{ content: "handled" }],
        },
      } as unknown as Event,
    ]);
    const sessionRecord = makeSessionRecord(client);
    const logs: Array<{ type: string; relevant: boolean }> = [];

    await subscribeOpencodeEvents({
      context: {
        sessionId: "local-session-1",
        externalSessionId: "external-session-1",
        input: makeSessionInput(),
      },
      client,
      controller: new AbortController(),
      now: () => "2026-02-22T12:00:00.000Z",
      emit: () => undefined,
      getSession: () => sessionRecord,
      logEvent: (entry) => {
        logs.push({ type: entry.event.type, relevant: entry.relevant });
      },
    });

    expect(logs).toEqual([
      { type: "todo.updated", relevant: false },
      { type: "todo.updated", relevant: true },
    ]);
  });

  test("applies queued part delta with append semantics", async () => {
    const emitted = await runEventStream([
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-1",
          messageID: "assistant-message-2",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-1",
            sessionID: "external-session-1",
            messageID: "assistant-message-2",
            type: "text",
            text: "Hello",
            time: { start: 1, end: 2 },
          },
        },
      } as unknown as Event,
    ]);

    const deltas = emitted.filter((event) => event.type === "assistant_delta");
    expect(deltas).toHaveLength(0);
    const parts = emitted.filter((event) => event.type === "assistant_part");
    expect(parts).toHaveLength(1);
    if (parts[0]?.type !== "assistant_part") {
      throw new Error("Expected assistant_part event");
    }
    expect(parts[0].part.kind).toBe("text");
    if (parts[0].part.kind !== "text") {
      throw new Error("Expected text assistant part");
    }
    expect(parts[0].part.text).toBe("Hello world");
  });

  test("replays queued deltas in FIFO order", async () => {
    const emitted = await runEventStream([
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-fifo",
          messageID: "assistant-message-fifo",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-fifo",
          messageID: "assistant-message-fifo",
          field: "text",
          delta: "!",
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-fifo",
            sessionID: "external-session-1",
            messageID: "assistant-message-fifo",
            type: "text",
            text: "Hello",
            time: { start: 1, end: 2 },
          },
        },
      } as unknown as Event,
    ]);

    const parts = emitted.filter((event) => event.type === "assistant_part");
    expect(parts).toHaveLength(1);
    if (parts[0]?.type !== "assistant_part" || parts[0].part.kind !== "text") {
      throw new Error("Expected assistant text part");
    }
    expect(parts[0].part.text).toBe("Hello world!");
  });

  test("keeps known-part and queued-part delta application consistent", async () => {
    const queuedPath = await runEventStream([
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-consistency",
          messageID: "assistant-message-consistency",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-consistency",
            sessionID: "external-session-1",
            messageID: "assistant-message-consistency",
            type: "text",
            text: "Hello",
            time: { start: 1, end: 2 },
          },
        },
      } as unknown as Event,
    ]);

    const knownPath = await runEventStream([
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-consistency",
            sessionID: "external-session-1",
            messageID: "assistant-message-consistency",
            type: "text",
            text: "Hello",
            time: { start: 1, end: 2 },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-consistency",
          messageID: "assistant-message-consistency",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
    ]);

    const queuedParts = queuedPath.filter((event) => event.type === "assistant_part");
    const knownParts = knownPath.filter((event) => event.type === "assistant_part");
    const lastQueued = queuedParts[queuedParts.length - 1];
    const lastKnown = knownParts[knownParts.length - 1];
    if (
      !lastQueued ||
      lastQueued.type !== "assistant_part" ||
      lastQueued.part.kind !== "text" ||
      !lastKnown ||
      lastKnown.type !== "assistant_part" ||
      lastKnown.part.kind !== "text"
    ) {
      throw new Error("Expected final assistant text parts");
    }
    expect(lastQueued.part.text).toBe("Hello world");
    expect(lastKnown.part.text).toBe("Hello world");
  });

  test("suppresses assistant_delta when delta belongs to user message", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-1",
            role: "user",
            sessionID: "external-session-1",
          },
        },
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          messageID: "user-message-1",
          delta: "typing...",
        },
      } as unknown as Event,
    ]);

    expect(emitted.filter((event) => event.type === "assistant_delta")).toHaveLength(0);
  });

  test("emits retry session_status payload", async () => {
    const emitted = await runEventStream([
      {
        type: "session.status",
        properties: {
          sessionID: "external-session-1",
          status: {
            type: "retry",
            attempt: 2,
            message: "Retrying request",
            next: 250,
          },
        },
      } as unknown as Event,
    ]);

    const statusEvents = emitted.filter((event) => event.type === "session_status");
    expect(statusEvents).toHaveLength(1);
    if (statusEvents[0]?.type !== "session_status") {
      throw new Error("Expected session_status event");
    }
    expect(statusEvents[0].status).toEqual({
      type: "retry",
      attempt: 2,
      message: "Retrying request",
      nextEpochMs: 250,
    });
  });

  test("forwards permission and question events", async () => {
    const emitted = await runEventStream([
      {
        type: "permission.asked",
        properties: {
          sessionID: "external-session-1",
          id: "perm-1",
          permission: "write",
          patterns: ["src/**"],
          metadata: { reason: "Need file write" },
        },
      } as unknown as Event,
      {
        type: "question.asked",
        properties: {
          sessionID: "external-session-1",
          id: "q-1",
          questions: [
            {
              header: "Scope",
              question: "Pick target",
              options: [{ label: "A", description: "Option A" }],
              custom: true,
            },
          ],
        },
      } as unknown as Event,
    ]);

    const permissionEvents = emitted.filter((event) => event.type === "permission_required");
    const questionEvents = emitted.filter((event) => event.type === "question_required");
    expect(permissionEvents).toHaveLength(1);
    expect(questionEvents).toHaveLength(1);
    if (permissionEvents[0]?.type !== "permission_required") {
      throw new Error("Expected permission_required event");
    }
    if (questionEvents[0]?.type !== "question_required") {
      throw new Error("Expected question_required event");
    }
    expect(permissionEvents[0].metadata).toEqual({ reason: "Need file write" });
    expect(questionEvents[0].questions).toHaveLength(1);
    expect(questionEvents[0].questions[0]?.header).toBe("Scope");
  });

  test("clears pending deltas when message part is removed", async () => {
    const emitted = await runEventStream([
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-2",
          messageID: "assistant-message-3",
          field: "text",
          delta: "stale ",
        },
      } as unknown as Event,
      {
        type: "message.part.removed",
        properties: {
          sessionID: "external-session-1",
          partID: "text-part-2",
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-part-2",
            sessionID: "external-session-1",
            messageID: "assistant-message-3",
            type: "text",
            text: "fresh",
            time: { start: 1, end: 2 },
          },
        },
      } as unknown as Event,
    ]);

    const parts = emitted.filter((event) => event.type === "assistant_part");
    expect(parts).toHaveLength(1);
    if (parts[0]?.type !== "assistant_part") {
      throw new Error("Expected assistant_part event");
    }
    if (parts[0].part.kind !== "text") {
      throw new Error("Expected text assistant part");
    }
    expect(parts[0].part.text).toBe("fresh");
  });

  test("normalizes unknown session error payload", async () => {
    const emitted = await runEventStream([
      {
        type: "session.error",
        properties: {
          sessionID: "external-session-1",
          error: { data: {} },
        },
      } as unknown as Event,
    ]);

    const errors = emitted.filter((event) => event.type === "session_error");
    expect(errors).toHaveLength(1);
    if (errors[0]?.type !== "session_error") {
      throw new Error("Expected session_error event");
    }
    expect(errors[0].message).toBe("Unknown session error");
  });

  test("does not replay duplicate delta after suppressed known user-part update", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "message-dup-1",
            role: "user",
            sessionID: "external-session-1",
          },
          parts: [
            {
              id: "part-dup-1",
              sessionID: "external-session-1",
              messageID: "message-dup-1",
              type: "text",
              text: "hello",
              time: { start: 1, end: 2 },
            },
          ],
        },
      } as unknown as Event,
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          messageID: "message-dup-1",
          partID: "part-dup-1",
          field: "text",
          delta: " world",
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "message-dup-1",
            role: "assistant",
            sessionID: "external-session-1",
            finish: "stop",
            time: { completed: 3 },
          },
          parts: [
            {
              id: "part-dup-1",
              sessionID: "external-session-1",
              messageID: "message-dup-1",
              type: "text",
              text: "hello world",
              time: { start: 1, end: 3 },
            },
          ],
        },
      } as unknown as Event,
    ]);

    const parts = emitted.filter((event) => event.type === "assistant_part");
    expect(parts).toHaveLength(1);
    if (parts[0]?.type !== "assistant_part" || parts[0].part.kind !== "text") {
      throw new Error("Expected assistant text part event");
    }
    expect(parts[0].part.text).toBe("hello world");
  });
});
