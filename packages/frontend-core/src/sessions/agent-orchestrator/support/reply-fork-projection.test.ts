import { expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/contracts";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEvent,
} from "../events/session-events-test-harness";
import { createSessionMessagesState } from "./messages";
import { applyLoadedSessionHistory, historyToChatMessages } from "./session-history-chat-messages";

const timestamp = "2026-10-22T10:00:00.000Z";
const forkPoint = { messageId: "reply" };
const historyReply = (): Extract<AgentSessionHistoryMessage, { role: "assistant" }> => ({
  role: "assistant",
  messageId: "reply",
  timestamp,
  text: "First paragraph\nFinal paragraph",
  parts: [
    { kind: "text", messageId: "reply", partId: "first", text: "First paragraph", completed: true },
    { kind: "text", messageId: "reply", partId: "last", text: "Final paragraph", completed: true },
    { kind: "step", messageId: "reply", partId: "finish", phase: "finish", reason: "stop" },
  ],
});

test("history gives only the final rendered text row the normalized fork target", () => {
  const messages = historyToChatMessages([{ ...historyReply(), forkPoint }], { role: "build" });
  expect(messages.map((message) => message.id)).toEqual(["text:reply:first", "text:reply:last"]);
  expect(messages[0]?.meta).not.toHaveProperty("forkPoint");
  expect(messages[1]?.meta).toMatchObject({ isFinal: true, forkPoint });

  const unfinished = historyToChatMessages(
    [{ ...historyReply(), forkPoint, parts: historyReply().parts.slice(0, 2) }],
    { role: "build" },
  );
  expect(unfinished.every((message) => !message.meta || !("forkPoint" in message.meta))).toBe(true);
});

test("hydration keeps a live completed target when whole text becomes separate history rows", () => {
  const session = buildSession({
    messages: createSessionMessagesState("session-1", [
      {
        id: "reply",
        role: "assistant",
        content: "First paragraph\nFinal paragraph",
        timestamp,
        meta: { kind: "assistant", isFinal: true, forkPoint },
      },
    ]),
  });
  const restored = applyLoadedSessionHistory(session, [historyReply()]);
  expect(restored.messages.items.map((message) => message.id)).toEqual([
    "text:reply:first",
    "text:reply:last",
  ]);
  expect(restored.messages.items[0]?.meta).not.toHaveProperty("forkPoint");
  expect(restored.messages.items[1]?.meta).toMatchObject({ isFinal: true, forkPoint });
});

test.each(["opencode", "claude", "codex"] as const)(
  "%s adds a late completed target and keeps it through final-event replay",
  async (runtimeKind) => {
    const sessionsRef = createSessionsRef([buildSession({ runtimeKind, status: "running" })]);
    let publish: ((event: SessionEvent) => void) | undefined;
    const unsubscribe = await listenToAgentSessionEvents({
      adapter: {
        subscribeEvents: async (_externalSessionId, handler) => {
          publish = handler;
          return () => {};
        },
        replyApproval: async () => {},
      },
      repoPath: "/tmp/repo",
      externalSessionId: "session-1",
      sessionsRef,
      updateSession: createSessionUpdater(sessionsRef),
      eventBatchWindowMs: 0,
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    });
    try {
      if (!publish) throw new Error("Expected a session event subscription.");
      for (const part of historyReply().parts) {
        publish({
          type: "assistant_part",
          externalSessionId: "session-1",
          timestamp,
          part: { ...part, messageId: "reply" },
        });
      }
      const finalEvent = {
        type: "assistant_message" as const,
        externalSessionId: "session-1",
        timestamp,
        messageId: "reply",
        message: "First paragraph\nFinal paragraph",
      };
      publish(finalEvent);
      expect(
        getSessionMessages(sessionsRef).every(
          (message) => !message.meta || !("forkPoint" in message.meta),
        ),
      ).toBe(true);
      publish({ ...finalEvent, forkPoint });
      publish(finalEvent);
      publish({ type: "session_idle", externalSessionId: "session-1", timestamp });
      const completed = getSessionMessages(sessionsRef).filter(
        (message) => message.meta?.kind === "assistant" && message.meta.forkPoint,
      );
      expect(completed).toHaveLength(1);
      expect(completed[0]?.meta).toMatchObject({ isFinal: true, forkPoint });
      publish(finalEvent);
      publish({ type: "session_idle", externalSessionId: "session-1", timestamp });
      expect(
        getSessionMessages(sessionsRef).filter(
          (message) => message.meta?.kind === "assistant" && message.meta.forkPoint,
        ),
      ).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  },
);
