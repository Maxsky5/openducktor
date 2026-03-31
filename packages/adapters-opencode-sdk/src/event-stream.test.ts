import { describe, expect, test } from "bun:test";
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { subscribeOpencodeEvents } from "./event-stream";
import type { SessionInput, SessionRecord } from "./types";

const makeClientWithEvents = (events: Event[]): OpencodeClient => {
  return {
    global: {
      event: async () => {
        async function* iterator(): AsyncGenerator<{ directory: string; payload: Event }> {
          for (const event of events) {
            const directory =
              (event as Event & { properties?: { directory?: string } }).properties?.directory ??
              "/repo";
            yield { directory, payload: event };
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
  runtimeKind: "opencode",
  runtimeConnection: {
    endpoint: "http://127.0.0.1:12345",
    workingDirectory: "/repo",
  },
  workingDirectory: "/repo",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  systemPrompt: "System prompt",
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
  eventTransportKey: "http://127.0.0.1:12345",
  hasIdleSinceActivity: false,
  activeAssistantMessageId: null,
  emittedAssistantMessageIds: new Set<string>(),
  emittedUserMessageSignatures: new Map<string, string>(),
  emittedUserMessageStates: new Map(),
  pendingQueuedUserMessages: [],
  partsById: new Map(),
  messageRoleById: new Map(),
  messageMetadataById: new Map(),
  pendingDeltasByPartId: new Map(),
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

const assistantRoleEvent = (messageId: string): Event =>
  ({
    type: "message.updated",
    properties: {
      info: {
        id: messageId,
        role: "assistant",
        sessionID: "external-session-1",
      },
    },
  }) as unknown as Event;

describe("event-stream", () => {
  test("emits user_message when opencode acknowledges a user turn", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-1",
            role: "user",
            sessionID: "external-session-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            text: "Generate the PR",
            time: {
              created: Date.parse("2026-02-22T12:00:03.000Z"),
            },
          },
        },
      } as unknown as Event,
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    if (userMessages[0]?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }
    expect(userMessages[0].messageId).toBe("user-message-1");
    expect(userMessages[0].message).toBe("Generate the PR");
    expect(userMessages[0].timestamp).toBe("2026-02-22T12:00:03.000Z");
    expect(userMessages[0].parts).toEqual([{ kind: "text", text: "Generate the PR" }]);
    expect(userMessages[0].model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });
  });

  test("emits user_message from stored user text parts when message.updated omits visible text", async () => {
    const emitted = await runEventStream([
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-part-1",
            sessionID: "external-session-1",
            messageID: "user-message-2",
            type: "text",
            text: "Generate the PR",
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-2",
            role: "user",
            sessionID: "external-session-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            time: {
              created: Date.parse("2026-02-22T12:00:04.000Z"),
            },
          },
        },
      } as unknown as Event,
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    if (userMessages[0]?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }
    expect(userMessages[0]).toMatchObject({
      messageId: "user-message-2",
      message: "Generate the PR",
      timestamp: "2026-02-22T12:00:04.000Z",
    });
    expect(userMessages[0].parts).toEqual([{ kind: "text", text: "Generate the PR" }]);
  });

  test("emits user_message when user text parts arrive after message.updated", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-3",
            role: "user",
            sessionID: "external-session-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            time: {
              created: Date.parse("2026-02-22T12:00:05.000Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-part-2",
            sessionID: "external-session-1",
            messageID: "user-message-3",
            type: "text",
            text: "Ship it",
          },
        },
      } as unknown as Event,
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    if (userMessages[0]?.type !== "user_message") {
      throw new Error("Expected user_message event");
    }
    expect(userMessages[0]).toMatchObject({
      messageId: "user-message-3",
      message: "Ship it",
      timestamp: "2026-02-22T12:00:05.000Z",
      state: "read",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
        profileId: "Hephaestus",
        variant: "high",
      },
    });
    expect(userMessages[0].parts).toEqual([{ kind: "text", text: "Ship it" }]);
  });

  test("re-emits user_message when later parts update the visible text", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-4",
            role: "user",
            sessionID: "external-session-1",
            text: "Old text",
            time: {
              created: Date.parse("2026-02-22T12:00:06.000Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-part-4",
            sessionID: "external-session-1",
            messageID: "user-message-4",
            type: "text",
            text: "New text",
          },
        },
      } as unknown as Event,
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "user-message-4",
      message: "Old text",
      state: "read",
    });
    expect(userMessages[1]).toMatchObject({
      type: "user_message",
      messageId: "user-message-4",
      message: "New text",
      state: "read",
    });
    expect(userMessages[1]?.parts).toEqual([{ kind: "text", text: "New text" }]);
  });

  test("preserves visible user text when later file parts arrive without visible text parts", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-5",
            role: "user",
            sessionID: "external-session-1",
            text: "check @src/main.ts please",
            time: {
              created: Date.parse("2026-02-22T12:00:07.000Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "user-file-5",
            sessionID: "external-session-1",
            messageID: "user-message-5",
            type: "file",
            mime: "text/plain",
            filename: "main.ts",
            url: "file:///repo/src/main.ts",
            source: {
              type: "file",
              path: "src/main.ts",
              text: {
                value: "@src/main.ts",
                start: 6,
                end: 18,
              },
            },
          },
        },
      } as unknown as Event,
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "user-message-5",
      message: "check @src/main.ts please",
    });
    expect(userMessages[1]).toMatchObject({
      type: "user_message",
      messageId: "user-message-5",
      message: "check @src/main.ts please",
      parts: [
        {
          kind: "text",
          text: "check @src/main.ts please",
        },
        {
          kind: "file_reference",
          file: {
            id: "user-file-5",
            path: "src/main.ts",
            name: "main.ts",
            kind: "code",
          },
          sourceText: {
            value: "@src/main.ts",
            start: 6,
            end: 18,
          },
        },
      ],
    });
  });

  test("keeps queued follow-ups queued until the pending assistant clears", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "message-100",
            role: "assistant",
            sessionID: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:01.000Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "message-200",
            role: "user",
            sessionID: "external-session-1",
            text: "Ship it",
            time: {
              created: Date.parse("2026-02-22T12:00:02.000Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "session.idle",
        properties: {
          sessionID: "external-session-1",
        },
      } as unknown as Event,
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "message-200",
      message: "Ship it",
      state: "queued",
    });
    expect(userMessages[1]).toMatchObject({
      type: "user_message",
      messageId: "message-200",
      message: "Ship it",
      state: "read",
    });
  });

  test("does not leave a late queued-send acknowledgement stuck queued after idle", async () => {
    const client = makeClientWithEvents([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "message-200",
            role: "user",
            sessionID: "external-session-1",
            text: "Ship it",
            time: {
              created: Date.parse("2026-02-22T12:00:02.000Z"),
            },
          },
        },
      } as unknown as Event,
    ]);
    const emitted: AgentEvent[] = [];
    const sessionRecord = makeSessionRecord(client);
    sessionRecord.pendingQueuedUserMessages.push({ content: "Ship it" });
    sessionRecord.activeAssistantMessageId = null;

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

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "message-200",
      message: "Ship it",
      state: "read",
    });
    expect(sessionRecord.pendingQueuedUserMessages).toHaveLength(0);
  });

  test("ignores unrelated status fields when deriving explicit user message state", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-100",
            role: "assistant",
            sessionID: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:01.000Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-200",
            role: "user",
            sessionID: "external-session-1",
            text: "Ship it",
            status: "read",
            time: {
              created: Date.parse("2026-02-22T12:00:02.000Z"),
            },
          },
        },
      } as unknown as Event,
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "msg-200",
      state: "queued",
    });
  });

  test("matches queued sends by exact model selection when content repeats", async () => {
    const client = makeClientWithEvents([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-200",
            role: "user",
            sessionID: "external-session-1",
            providerID: "openai",
            modelID: "gpt-5",
            agent: "Hephaestus",
            variant: "high",
            text: "Ship it",
            time: {
              created: Date.parse("2026-02-22T12:00:02.000Z"),
            },
          },
        },
      } as unknown as Event,
    ]);
    const emitted: AgentEvent[] = [];
    const sessionRecord = makeSessionRecord(client);
    sessionRecord.activeAssistantMessageId = "msg-100";
    sessionRecord.pendingQueuedUserMessages.push(
      { content: "Ship it" },
      {
        content: "Ship it",
        model: {
          providerId: "openai",
          modelId: "gpt-5",
          profileId: "Hephaestus",
          variant: "high",
        },
      },
    );

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

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "msg-200",
      state: "queued",
    });
    expect(sessionRecord.pendingQueuedUserMessages).toEqual([{ content: "Ship it" }]);
  });

  test("reconciles queued follow-ups when a newer assistant becomes pending", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-100",
            role: "assistant",
            sessionID: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:01.000Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-200",
            role: "user",
            sessionID: "external-session-1",
            text: "Ship it",
            time: {
              created: Date.parse("2026-02-22T12:00:02.000Z"),
            },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-300",
            role: "assistant",
            parentID: "msg-200",
            sessionID: "external-session-1",
            time: {
              created: Date.parse("2026-02-22T12:00:03.000Z"),
            },
          },
        },
      } as unknown as Event,
    ]);

    const userMessages = emitted.filter((event) => event.type === "user_message");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]).toMatchObject({
      type: "user_message",
      messageId: "msg-200",
      state: "queued",
    });
    expect(userMessages[1]).toMatchObject({
      type: "user_message",
      messageId: "msg-200",
      state: "read",
    });
  });

  test("deduplicates assistant_message across repeated message.updated events", async () => {
    const assistantEvent = {
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-message-1",
          role: "assistant",
          sessionID: "external-session-1",
          providerID: "openai",
          modelID: "gpt-5",
          agent: "Hephaestus",
          variant: "high",
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
    expect(assistantMessages[0].messageId).toBe("assistant-message-1");
    expect(assistantMessages[0].totalTokens).toBe(120);
    expect(assistantMessages[0].model).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "Hephaestus",
      variant: "high",
    });
    expect(emitted.some((event) => event.type === "assistant_part")).toBe(true);
  });

  test("emits session_idle for stop-finished assistant turns without visible text", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-stop-only",
            role: "assistant",
            sessionID: "external-session-1",
            finish: "stop",
          },
          parts: [
            {
              id: "step-1",
              sessionID: "external-session-1",
              messageID: "assistant-message-stop-only",
              type: "step-finish",
              reason: "stop",
            },
          ],
        },
      } as unknown as Event,
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
    expect(emitted.some((event) => event.type === "assistant_message")).toBe(false);
  });

  test("does not emit session_idle or final assistant_message when completion lacks a stop signal", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-completed-time",
            role: "assistant",
            sessionID: "external-session-1",
            time: {
              completed: 1,
            },
          },
          parts: [
            {
              id: "text-completed-time-1",
              sessionID: "external-session-1",
              messageID: "assistant-message-completed-time",
              type: "text",
              text: "Completed without finish stop",
              time: { start: 1, end: 1 },
            },
          ],
        },
      } as unknown as Event,
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(0);
    expect(emitted.some((event) => event.type === "assistant_message")).toBe(false);
  });

  test("deduplicates upstream session.idle after a terminal assistant update", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-terminal-idle",
            role: "assistant",
            sessionID: "external-session-1",
            finish: "stop",
          },
          parts: [
            {
              id: "text-terminal-idle-1",
              sessionID: "external-session-1",
              messageID: "assistant-message-terminal-idle",
              type: "text",
              text: "Done once",
              time: { start: 1, end: 1 },
            },
          ],
        },
      } as unknown as Event,
      {
        type: "session.idle",
        properties: {
          sessionID: "external-session-1",
        },
      } as unknown as Event,
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("emits final assistant_message from known parts when terminal metadata arrives later", async () => {
    const emitted = await runEventStream([
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-part-late-1",
            sessionID: "external-session-1",
            messageID: "assistant-message-late-final",
            type: "text",
            text: "Final answer",
            time: { start: 1, end: 1 },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-late-final",
            role: "assistant",
            sessionID: "external-session-1",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            agent: "Hephaestus",
            variant: "max",
            tokens: {
              input: 10,
              output: 5,
            },
            time: {
              created: Date.parse("2026-02-22T12:00:06.000Z"),
              completed: Date.parse("2026-02-22T12:00:08.000Z"),
            },
            finish: "stop",
          },
        },
      } as unknown as Event,
    ]);

    const assistantMessages = emitted.filter((event) => event.type === "assistant_message");
    expect(assistantMessages).toHaveLength(1);
    if (assistantMessages[0]?.type !== "assistant_message") {
      throw new Error("Expected assistant_message event");
    }
    expect(assistantMessages[0]).toMatchObject({
      messageId: "assistant-message-late-final",
      message: "Final answer",
      totalTokens: 15,
      model: {
        providerId: "anthropic",
        modelId: "claude-sonnet",
        profileId: "Hephaestus",
        variant: "max",
      },
    });

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("does not emit idle or final assistant_message from known parts without a stop signal", async () => {
    const emitted = await runEventStream([
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "assistant-part-late-2",
            sessionID: "external-session-1",
            messageID: "assistant-message-late-nonfinal",
            type: "text",
            text: "Intermediate answer",
            time: { start: 1, end: 1 },
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-late-nonfinal",
            role: "assistant",
            sessionID: "external-session-1",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            agent: "Hephaestus",
            variant: "max",
            tokens: {
              input: 10,
              output: 5,
            },
            time: {
              created: Date.parse("2026-02-22T12:00:06.000Z"),
              completed: Date.parse("2026-02-22T12:00:08.000Z"),
            },
          },
        },
      } as unknown as Event,
    ]);

    expect(emitted.some((event) => event.type === "assistant_message")).toBe(false);
    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(0);
  });

  test("preserves existing idle state when session.idle arrives before a terminal assistant update", async () => {
    const emitted = await runEventStream([
      {
        type: "session.idle",
        properties: {
          sessionID: "external-session-1",
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-idle-first",
            role: "assistant",
            sessionID: "external-session-1",
            finish: "stop",
          },
          parts: [
            {
              id: "text-idle-first-1",
              sessionID: "external-session-1",
              messageID: "assistant-message-idle-first",
              type: "text",
              text: "Done after idle",
              time: { start: 1, end: 1 },
            },
          ],
        },
      } as unknown as Event,
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("does not emit duplicate session_idle across repeated terminal message updates", async () => {
    const terminalEvent = {
      type: "message.updated",
      properties: {
        info: {
          id: "assistant-message-duplicate-terminal",
          role: "assistant",
          sessionID: "external-session-1",
          finish: "stop",
          time: {
            completed: 1,
          },
        },
        parts: [
          {
            id: "text-duplicate-terminal-1",
            sessionID: "external-session-1",
            messageID: "assistant-message-duplicate-terminal",
            type: "text",
            text: "Done twice",
            time: { start: 1, end: 1 },
          },
        ],
      },
    } as unknown as Event;

    const emitted = await runEventStream([terminalEvent, terminalEvent]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
  });

  test("marks session idle on session.status idle so later terminal updates do not duplicate it", async () => {
    const emitted = await runEventStream([
      {
        type: "session.status",
        properties: {
          sessionID: "external-session-1",
          status: {
            type: "idle",
          },
        },
      } as unknown as Event,
      {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-message-status-idle",
            role: "assistant",
            sessionID: "external-session-1",
            time: {
              completed: 1,
            },
            finish: "stop",
          },
          parts: [
            {
              id: "text-status-idle-1",
              sessionID: "external-session-1",
              messageID: "assistant-message-status-idle",
              type: "text",
              text: "Done after idle status",
              time: { start: 1, end: 1 },
            },
          ],
        },
      } as unknown as Event,
    ]);

    const statusEvents = emitted.filter((event) => event.type === "session_status");
    expect(statusEvents).toHaveLength(1);
    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(0);
  });

  test("replays known assistant parts when the assistant role becomes known later", async () => {
    const emitted = await runEventStream([
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "text-late-role-1",
            sessionID: "external-session-1",
            messageID: "assistant-message-late-role-1",
            type: "text",
            text: "Late role text",
          },
        },
      } as unknown as Event,
      assistantRoleEvent("assistant-message-late-role-1"),
    ]);

    const partEvents = emitted.filter((event) => event.type === "assistant_part");
    expect(partEvents).toHaveLength(1);
    if (partEvents[0]?.type !== "assistant_part" || partEvents[0].part.kind !== "text") {
      throw new Error("Expected assistant text part event");
    }
    expect(partEvents[0].part.text).toBe("Late role text");
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

  test("routes directory-scoped global events only to matching working directories", async () => {
    const emitted = await runEventStream([
      {
        type: "session.idle",
        properties: {
          directory: "/other",
        },
      } as unknown as Event,
      {
        type: "session.idle",
        properties: {
          directory: "/repo",
        },
      } as unknown as Event,
    ]);

    const idleEvents = emitted.filter((event) => event.type === "session_idle");
    expect(idleEvents).toHaveLength(1);
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
      assistantRoleEvent("assistant-message-2"),
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
      assistantRoleEvent("assistant-message-fifo"),
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
      assistantRoleEvent("assistant-message-consistency"),
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
      assistantRoleEvent("assistant-message-consistency"),
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

  test("emits reasoning channel for reasoning fallback deltas", async () => {
    const emitted = await runEventStream([
      assistantRoleEvent("assistant-message-reasoning"),
      {
        type: "message.part.delta",
        properties: {
          sessionID: "external-session-1",
          messageID: "assistant-message-reasoning",
          field: "reasoning_content",
          delta: "Hidden chain of thought",
        },
      } as unknown as Event,
    ]);

    const deltas = emitted.filter((event) => event.type === "assistant_delta");
    expect(deltas).toHaveLength(1);
    if (deltas[0]?.type !== "assistant_delta") {
      throw new Error("Expected assistant_delta event");
    }
    expect(deltas[0]).toMatchObject({
      channel: "reasoning",
      messageId: "assistant-message-reasoning",
      delta: "Hidden chain of thought",
    });
  });

  test("suppresses non-assistant reasoning parts", async () => {
    const emitted = await runEventStream([
      {
        type: "message.updated",
        properties: {
          info: {
            id: "user-message-reasoning",
            role: "user",
            sessionID: "external-session-1",
          },
          parts: [
            {
              id: "reasoning-user-1",
              sessionID: "external-session-1",
              messageID: "user-message-reasoning",
              type: "reasoning",
              text: "Should not surface",
              time: { start: 1, end: 2 },
            },
          ],
        },
      } as unknown as Event,
    ]);

    expect(emitted.filter((event) => event.type === "assistant_part")).toHaveLength(0);
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

  test("normalizes unknown session.status types as retry payload", async () => {
    const emitted = await runEventStream([
      {
        type: "session.status",
        properties: {
          sessionID: "external-session-1",
          status: {
            type: "reconnect",
            attempt: 3,
            message: "Reconnecting",
            next: 500,
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
      attempt: 3,
      message: "Reconnecting",
      nextEpochMs: 500,
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
      assistantRoleEvent("assistant-message-3"),
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
