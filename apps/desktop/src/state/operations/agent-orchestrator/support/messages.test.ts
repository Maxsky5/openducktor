import { describe, expect, test } from "bun:test";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import {
  appendSessionMessage,
  everySessionMessage,
  findLastToolSessionMessage,
  findLastUserSessionMessage,
  getSessionMessageCount,
  updateLastSessionMessage,
  updateLastToolSessionMessage,
  upsertSessionMessage,
} from "./messages";

const createSession = (messages: AgentSessionState["messages"]) => ({
  sessionId: "session-1",
  messages,
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
        meta: { kind: "tool", partId: "p1", callId: "c1", tool: "bash", status: "running" },
      },
      {
        id: "tool-2",
        role: "tool",
        content: "running",
        timestamp: "2026-02-22T08:00:01.000Z",
        meta: { kind: "tool", partId: "p2", callId: "c2", tool: "bash", status: "running" },
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
});
