import { describe, expect, test } from "bun:test";
import {
  createSessionMessagesFixture,
  type SessionMessagesFixtureInput,
  sessionMessageAt,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  appendSessionMessage,
  areSessionMessagesSameRevision,
  createSessionMessagesState,
  everySessionMessage,
  findFirstChangedSessionMessageIndex,
  findLastToolSessionMessage,
  findLastUserSessionMessage,
  getSessionMessageAt,
  getSessionMessageCount,
  isFinalAssistantChatMessage,
  updateLastSessionMessage,
  updateLastToolSessionMessage,
  upsertSessionMessage,
} from "./messages";

const createSession = (messages: SessionMessagesFixtureInput) => ({
  externalSessionId: "session-1",
  messages: createSessionMessagesFixture("session-1", messages),
});

describe("agent-orchestrator/support/messages", () => {
  test("upserts messages by id", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "m1",
        role: "system",
        content: "old",
        timestamp: "2026-02-22T08:00:00.000Z",
      },
    ];

    const appended = upsertSessionMessage(createSession(messages), {
      id: "m2",
      role: "system",
      content: "new",
      timestamp: "2026-02-22T08:00:01.000Z",
    });
    expect(getSessionMessageCount(createSession(appended))).toBe(2);

    const replaced = upsertSessionMessage(createSession(appended), {
      id: "m1",
      role: "system",
      content: "updated",
      timestamp: "2026-02-22T08:00:02.000Z",
    });
    expect(getSessionMessageCount(createSession(replaced))).toBe(2);
    expect(sessionMessageAt(createSession(replaced), 0)?.content).toBe("updated");
  });

  test("finds the last message by role without scanning callers manually", () => {
    const messages: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "First", timestamp: "2026-02-22T08:00:00.000Z" },
      {
        id: "a1",
        role: "assistant",
        content: "Reply",
        timestamp: "2026-02-22T08:00:01.000Z",
      },
      { id: "u2", role: "user", content: "Second", timestamp: "2026-02-22T08:00:02.000Z" },
    ];

    expect(findLastUserSessionMessage(createSession(messages))?.id).toBe("u2");
  });

  test("updates only the last matching tool message", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "tool-1",
        role: "tool",
        content: "running",
        timestamp: "2026-02-22T08:00:00.000Z",
        meta: {
          kind: "tool",
          partId: "p1",
          callId: "c1",
          tool: "bash",
          toolType: "bash",
          status: "running",
        },
      },
      {
        id: "tool-2",
        role: "tool",
        content: "running",
        timestamp: "2026-02-22T08:00:01.000Z",
        meta: {
          kind: "tool",
          partId: "p2",
          callId: "c2",
          tool: "bash",
          toolType: "bash",
          status: "running",
        },
      },
    ];

    const updated = updateLastToolSessionMessage(
      createSession(messages),
      (message) => message.meta?.kind === "tool" && message.meta.callId === "c2",
      (message) => ({ ...message, content: "completed" }),
    );

    expect(sessionMessageAt(createSession(updated), 0)?.content).toBe("running");
    expect(sessionMessageAt(createSession(updated), 1)?.content).toBe("completed");
  });

  test("updates the last message without exposing indexes", () => {
    const messages: AgentChatMessage[] = [
      { id: "m1", role: "system", content: "one", timestamp: "2026-02-22T08:00:00.000Z" },
      { id: "m2", role: "assistant", content: "two", timestamp: "2026-02-22T08:00:01.000Z" },
    ];

    const updated = updateLastSessionMessage(createSession(messages), (message) => ({
      ...message,
      content: "updated",
    }));

    expect(sessionMessageAt(createSession(updated), 0)?.content).toBe("one");
    expect(sessionMessageAt(createSession(updated), 1)?.content).toBe("updated");
  });

  test("appends messages while preserving indexed lookups", () => {
    const messages: AgentChatMessage[] = [];
    const appended = appendSessionMessage(createSession(messages), {
      id: "system-1",
      role: "system",
      content: "Started",
      timestamp: "2026-02-22T08:00:00.000Z",
    });

    expect(getSessionMessageCount(createSession(appended))).toBe(1);
    expect(findLastToolSessionMessage(createSession(appended))).toBeUndefined();
  });

  test("matches Array.every semantics for empty collections", () => {
    expect(everySessionMessage(createSession([]), () => false)).toBe(true);
  });

  test("rejects messages owned by another session", () => {
    const messages = createSessionMessagesState("session-2");

    expect(() => getSessionMessageCount({ externalSessionId: "session-1", messages })).toThrow(
      "belong to 'session-2'",
    );
  });

  test("compares message states through the canonical revision contract", () => {
    const messages = [
      {
        id: "m1",
        role: "user" as const,
        content: "Question",
        timestamp: "2026-02-22T08:00:00.000Z",
      },
    ];
    const first = createSessionMessagesState("session-1", messages, 3);
    const equivalent = createSessionMessagesState("session-1", messages, 3);
    const nextVersion = createSessionMessagesState("session-1", messages, 4);
    const nextCount = createSessionMessagesState(
      "session-1",
      [
        ...messages,
        {
          id: "m2",
          role: "assistant" as const,
          content: "Answer",
          timestamp: "2026-02-22T08:00:01.000Z",
        },
      ],
      3,
    );

    expect(
      areSessionMessagesSameRevision(
        { externalSessionId: "session-1", messages: first },
        { externalSessionId: "session-1", messages: equivalent },
      ),
    ).toBe(true);
    expect(
      areSessionMessagesSameRevision(
        { externalSessionId: "session-1", messages: first },
        { externalSessionId: "session-1", messages: nextVersion },
      ),
    ).toBe(false);
    expect(
      areSessionMessagesSameRevision(
        { externalSessionId: "session-1", messages: first },
        { externalSessionId: "session-1", messages: nextCount },
      ),
    ).toBe(false);
  });

  test("detects final assistant chat messages", () => {
    expect(
      isFinalAssistantChatMessage({
        id: "assistant-final",
        role: "assistant",
        content: "done",
        timestamp: "2026-02-22T08:00:00.000Z",
        meta: {
          kind: "assistant",
          agentRole: "build",
          isFinal: true,
        },
      }),
    ).toBe(true);

    expect(
      isFinalAssistantChatMessage({
        id: "assistant-streaming",
        role: "assistant",
        content: "still going",
        timestamp: "2026-02-22T08:00:01.000Z",
        meta: {
          kind: "assistant",
          agentRole: "build",
          isFinal: false,
        },
      }),
    ).toBe(false);
  });

  test("finds the final changed message index for tail-only message updates", () => {
    const previousSession = createSession(
      Array.from({ length: 400 }, (_, index) => ({
        id: `message-${index}`,
        role: "assistant" as const,
        content: `Message ${index}`,
        timestamp: `2026-02-22T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
        meta: {
          kind: "assistant" as const,
          agentRole: "build" as const,
          isFinal: true,
        },
      })),
    );
    const previousMessages = previousSession.messages;
    const nextMessages = sessionMessagesToArray(previousSession);
    const lastMessage = getSessionMessageAt(previousSession, 399);
    if (!lastMessage) {
      throw new Error("Expected last message fixture");
    }

    nextMessages[399] = {
      ...lastMessage,
      content: "Updated final message",
    };

    expect(
      findFirstChangedSessionMessageIndex(previousMessages, {
        ...previousSession,
        messages: createSessionMessagesState(previousSession.externalSessionId, nextMessages),
      }),
    ).toBe(399);
  });

  test("finds the append point when new messages are added", () => {
    const previousSession = createSession([
      {
        id: "message-0",
        role: "assistant",
        content: "Message 0",
        timestamp: "2026-02-22T08:00:00.000Z",
      },
      {
        id: "message-1",
        role: "assistant",
        content: "Message 1",
        timestamp: "2026-02-22T08:01:00.000Z",
      },
      {
        id: "message-2",
        role: "assistant",
        content: "Message 2",
        timestamp: "2026-02-22T08:02:00.000Z",
      },
      {
        id: "message-3",
        role: "assistant",
        content: "Message 3",
        timestamp: "2026-02-22T08:03:00.000Z",
      },
    ]);
    const previousMessages = previousSession.messages;
    const nextMessages = [
      ...sessionMessagesToArray(previousSession),
      {
        id: "message-4",
        role: "assistant" as const,
        content: "Message 4",
        timestamp: "2026-02-22T08:04:00.000Z",
      },
    ];

    expect(
      findFirstChangedSessionMessageIndex(previousMessages, {
        ...previousSession,
        messages: createSessionMessagesState(previousSession.externalSessionId, nextMessages),
      }),
    ).toBe(4);
  });
});
