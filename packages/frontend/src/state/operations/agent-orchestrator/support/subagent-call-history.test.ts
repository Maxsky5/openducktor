import { expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/contracts";
import type { SubagentMeta } from "./subagent-messages";
import { upsertSubagentMessage } from "./subagent-messages";
import { createSessionMessagesState } from "./messages";
import { historyToChatMessages } from "./session-history-chat-messages";
import { mergeHistoryMessages } from "./history-message-merge";

const call = (
  id: string,
  status: SubagentMeta["status"],
  startedAtMs: number,
  endedAtMs?: number,
): AgentSessionHistoryMessage => {
  const part: AgentSessionHistoryMessage["parts"][number] = {
    kind: "subagent",
    messageId: `msg_${id}`,
    partId: `${id}:subagent`,
    correlationKey: `call:${id}`,
    externalSessionId: "ses_child",
    status,
    agent: "general",
    executionMode: "background",
    prompt: `Prompt ${id}`,
    description: `Review ${id}`,
    startedAtMs,
  };
  if (endedAtMs !== undefined) part.endedAtMs = endedAtMs;
  if (status === "error") part.error = "Subagent failed.";
  return {
    role: "assistant",
    messageId: `msg_${id}`,
    text: "",
    timestamp: new Date(startedAtMs).toISOString(),
    parts: [part],
  };
};

const chat = (history: AgentSessionHistoryMessage[]) =>
  historyToChatMessages(history, { role: "build" });
const expected = [
  {
    meta: {
      correlationKey: "call:first",
      status: "error",
      description: "Review first",
      prompt: "Prompt first",
      endedAtMs: 5,
    },
  },
  {
    meta: {
      correlationKey: "call:second",
      status: "completed",
      description: "Review second",
      prompt: "Prompt second",
      endedAtMs: 12,
    },
  },
];

test("keeps a failed call and successful continuation as separate history cards", () => {
  const messages = chat([call("first", "error", 2, 5), call("second", "completed", 8, 12)]);
  expect(messages).toHaveLength(2);
  expect(messages).toMatchObject(expected);
});

test("updates each live call without replacing another call to the same child", () => {
  let messages = createSessionMessagesState("parent");
  for (const history of [
    call("first", "error", 2, 5),
    call("second", "running", 8),
    call("first", "error", 2, 5),
    call("second", "completed", 8, 12),
  ]) {
    const message = chat([history])[0]!;
    if (message.meta?.kind !== "subagent") throw new Error("Expected subagent card");
    messages = upsertSubagentMessage({
      owner: { externalSessionId: "parent", messages },
      incomingMeta: message.meta,
      timestamp: message.timestamp,
    });
  }
  expect(messages.items).toHaveLength(2);
  expect(messages.items).toMatchObject(expected);
});

test("refreshes history without absorbing live continuations into earlier calls", () => {
  const loaded = chat([call("first", "error", 2, 5), call("second", "running", 8)]);
  const current = chat([call("second", "completed", 8, 12), call("third", "running", 14)]);
  const messages = mergeHistoryMessages(
    "parent",
    createSessionMessagesState("parent", loaded),
    createSessionMessagesState("parent", current),
  );
  expect(messages.items).toHaveLength(3);
  expect(messages.items).toMatchObject([
    ...expected,
    { meta: { correlationKey: "call:third", status: "running" } },
  ]);
});
