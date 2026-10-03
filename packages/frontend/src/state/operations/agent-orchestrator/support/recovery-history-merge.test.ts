import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { handleAssistantPart } from "../events/session-parts";
import type { SessionPartEventContext } from "../events/session-event-types";
import { createSessionTurnMetadata } from "./session-turn-metadata";
import { expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";
import { mergeRecoveryHistory } from "./recovery-history-merge";

const message = (id: string, content: string): AgentChatMessage => ({
  id,
  content,
  role: "assistant",
  timestamp: "2026-09-30T10:00:00Z",
});
const messages = (...items: AgentChatMessage[]) => createSessionMessagesState("session", items);

test("recovery repairs unchanged items and preserves newer cumulative values by native identity", () => {
  const old = message("old", "missing suffix");
  const active = message("active", "initial");
  const latest = message("active", "new cumulative text");
  const newItem = message("new", "published during read");
  const result = mergeRecoveryHistory(
    "session",
    messages(message("old", "complete old content"), message("active", "stale read")),
    messages(old, latest, newItem),
    messages(old, active),
  );
  expect(result.items.map(({ id, content }) => ({ id, content }))).toEqual([
    { id: "old", content: "complete old content" },
    { id: "active", content: "new cumulative text" },
    { id: "new", content: "published during read" },
  ]);
});

test("recovery preserves retractions and does not identify equal text as the same item", () => {
  const removed = message("removed", "same text");
  const current = message("different-native-id", "same text");
  const result = mergeRecoveryHistory(
    "session",
    messages(removed, message("historical-native-id", "same text")),
    messages(current),
    messages(removed),
  );
  expect(result.items.map(({ id }) => id)).toEqual(["historical-native-id", "different-native-id"]);
});

test("uncovered append-only overlap fails instead of duplicating or truncating output", () => {
  const old = message("active", "prefix");
  expect(() =>
    mergeRecoveryHistory(
      "session",
      messages(message("active", "prefixdelta")),
      messages(message("active", "prefixdelta")),
      messages(old),
      new Set(["active"]),
    ),
  ).toThrow("without cumulative coverage");
});

test("cumulative text after recovery updates the recovered native part instead of adding a row", () => {
  const old = {
    ...message("native-message", "prefix"),
    meta: {
      kind: "assistant" as const,
      sourceMessageId: "native-message",
      partId: "native-part",
      isFinal: false,
    },
  };
  const loaded = { ...old, id: "text:native-message:native-part", content: "recovered prefix" };
  let session = createAgentSessionFixture({
    runtimeKind: "opencode",
    externalSessionId: "session",
    messages: mergeRecoveryHistory("session", messages(loaded), messages(old), messages(old)),
  });
  const context: SessionPartEventContext = {
    session: { identity: session, key: "session", repoPath: "/repo" },
    store: {
      readSession: () => session,
      updateSession: (_identity, update) => {
        session = update(session);
        return session;
      },
      isSessionObserved: () => true,
      ensureSession: () => session,
    },
    turn: {
      turnMetadata: createSessionTurnMetadata(),
      recordTurnActivityTimestamp: () => {},
      recordTurnUserMessageTimestamp: () => {},
      resolveTurnDurationMs: () => undefined,
      clearTurnDuration: () => {},
    },
    todos: { updateSessionTodos: () => {} },
  };
  handleAssistantPart(context, {
    type: "assistant_part",
    externalSessionId: "session",
    timestamp: "2026-09-30T10:00:01Z",
    part: {
      kind: "text",
      messageId: "native-message",
      partId: "native-part",
      text: "recovered prefix plus output",
      completed: false,
    },
  });
  expect(session.messages.items).toHaveLength(1);
  expect(session.messages.items[0]?.content).toBe("recovered prefix plus output");
});
