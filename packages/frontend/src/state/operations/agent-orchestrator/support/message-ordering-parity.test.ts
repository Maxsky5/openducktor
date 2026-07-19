import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { mergeHistoryMessages } from "./history-message-merge";
import { createSessionMessagesState, upsertSessionMessageByTimestamp } from "./messages";

const externalSessionId = "session-1";

const systemPrompt: AgentChatMessage = {
  id: `history:system-prompt:${externalSessionId}`,
  role: "system",
  content: "System prompt",
  timestamp: "2026-03-01T09:00:10.000Z",
};

const userMessage: AgentChatMessage = {
  id: "user-1",
  role: "user",
  content: "Start",
  timestamp: "2026-03-01T09:00:20.000Z",
};

const subagentMessage: AgentChatMessage = {
  id: "subagent:task-1",
  role: "system",
  content: "Subagent (general-purpose): Inspect authentication",
  timestamp: "2026-03-01T09:00:05.000Z",
  meta: {
    kind: "subagent",
    partId: "claude-subagent:task-1",
    correlationKey: "task-1",
    status: "completed",
  },
};

describe("agent transcript timestamp ordering parity", () => {
  test("keeps the system prompt pinned before live and hydrated timestamp inserts", () => {
    const initialMessages = createSessionMessagesState(externalSessionId, [
      systemPrompt,
      userMessage,
    ]);
    const liveMessages = upsertSessionMessageByTimestamp(
      { externalSessionId, messages: initialMessages },
      subagentMessage,
    );
    const hydratedMessages = mergeHistoryMessages(
      externalSessionId,
      initialMessages,
      createSessionMessagesState(externalSessionId, [subagentMessage]),
    );
    const ids = ["history:system-prompt:session-1", "subagent:task-1", "user-1"];

    expect(liveMessages.items.map((message) => message.id)).toEqual(ids);
    expect(hydratedMessages.items.map((message) => message.id)).toEqual(ids);
  });

  for (const scenario of [
    {
      name: "keeps stable ties after existing messages",
      timestamp: userMessage.timestamp,
    },
    {
      name: "appends invalid timestamps",
      timestamp: "not-a-timestamp",
    },
  ]) {
    test(`${scenario.name} in live and hydrated inserts`, () => {
      const incoming = { ...subagentMessage, timestamp: scenario.timestamp };
      const initialMessages = createSessionMessagesState(externalSessionId, [
        systemPrompt,
        userMessage,
      ]);
      const liveMessages = upsertSessionMessageByTimestamp(
        { externalSessionId, messages: initialMessages },
        incoming,
      );
      const hydratedMessages = mergeHistoryMessages(
        externalSessionId,
        initialMessages,
        createSessionMessagesState(externalSessionId, [incoming]),
      );
      const ids = ["history:system-prompt:session-1", "user-1", "subagent:task-1"];

      expect(liveMessages.items.map((message) => message.id)).toEqual(ids);
      expect(hydratedMessages.items.map((message) => message.id)).toEqual(ids);
    });
  }
});
