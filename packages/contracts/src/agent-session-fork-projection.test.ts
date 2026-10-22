import { expect, test } from "bun:test";
import { agentSessionHistoryMessageSchema } from "./agent-engine-schemas";
import { agentRuntimeEventSchema } from "./agent-session-event-schemas";

test("completed-reply targets survive history and live transcript validation", () => {
  const forkPoint = { messageId: "normalized-reply" };
  const history = {
    messageId: "normalized-reply",
    role: "assistant" as const,
    timestamp: "2026-10-22T10:00:00.000Z",
    text: "Done",
    parts: [],
    forkPoint,
  };
  const live = {
    type: "assistant_message" as const,
    externalSessionId: "source",
    timestamp: history.timestamp,
    messageId: history.messageId,
    message: history.text,
    forkPoint,
  };
  expect(agentSessionHistoryMessageSchema.parse(history)).toEqual(history);
  expect(agentRuntimeEventSchema.parse(live)).toEqual(live);
  expect(
    agentSessionHistoryMessageSchema.safeParse({ ...history, forkPoint: { messageId: "" } })
      .success,
  ).toBe(false);
  expect(agentRuntimeEventSchema.safeParse({ ...live, forkPoint: { messageId: "" } }).success).toBe(
    false,
  );
});
