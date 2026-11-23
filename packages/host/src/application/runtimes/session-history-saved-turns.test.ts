import { expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentSessionTurnRecord } from "../../ports/agent-session-turn-store-port";
import { agentSessionMessageFingerprint } from "../../domain/agent-session-message-fingerprint";
import { applySavedTurns } from "./session-history-saved-turns";

const READ_AT = "2026-11-22T12:00:00.000Z";
const model = { runtimeKind: "codex" as const, providerId: "openai", modelId: "m" };
const finish = {
  kind: "step",
  messageId: "a1",
  partId: "a1:finish",
  phase: "finish",
  reason: "stop",
} as const;

const user = (messageId: string, text: string): AgentSessionHistoryMessage => ({
  messageId,
  role: "user",
  timestamp: READ_AT,
  timestampIsApproximate: true,
  text,
  displayParts: [],
  state: "read",
  parts: [],
});
const reply = (messageId: string): AgentSessionHistoryMessage => ({
  messageId,
  role: "assistant",
  timestamp: READ_AT,
  timestampIsApproximate: true,
  text: "Reply",
  parts: [{ ...finish, messageId, partId: `${messageId}:finish` }],
});
const turn = (overrides: Partial<AgentSessionTurnRecord>): AgentSessionTurnRecord => ({
  runtimeKind: "codex",
  externalSessionId: "session-1",
  userMessageId: "u1",
  userMessageHash: agentSessionMessageFingerprint("Hi"),
  startedAt: "2026-11-22T10:00:00.000Z",
  model,
  ...overrides,
});

test("gives a replay the saved times, model, duration, and stop notice", () => {
  const merged = applySavedTurns(
    [user("u1", "Hi"), reply("a1"), user("u2", "Stop"), reply("a2")],
    [
      turn({
        end: {
          completedAt: "2026-11-22T10:00:05.000Z",
          outcome: "completed",
          durationMs: 5000,
          finalMessageId: "a1",
        },
      }),
      turn({
        userMessageId: "u2",
        userMessageHash: agentSessionMessageFingerprint("Stop"),
        startedAt: "2026-11-22T10:01:00.000Z",
        end: {
          completedAt: "2026-11-22T10:01:09.000Z",
          outcome: "interrupted",
          interruption: { messageId: "stop-1", message: "Session stopped at your request." },
        },
      }),
    ],
    false,
  );

  expect(
    merged.map((entry) => [entry.messageId, entry.timestamp, entry.timestampIsApproximate]),
  ).toEqual([
    ["u1", "2026-11-22T10:00:00.000Z", undefined],
    ["a1", "2026-11-22T10:00:05.000Z", undefined],
    ["u2", "2026-11-22T10:01:00.000Z", undefined],
    ["a2", "2026-11-22T10:01:00.000Z", true],
    ["stop-1", "2026-11-22T10:01:09.000Z", undefined],
  ]);
  expect(merged[1]).toMatchObject({ model, durationMs: 5000 });
  // A stopped run has no final reply, so its last reply loses the final mark.
  expect(merged[3]?.parts).toEqual([]);
  expect(merged[4]).toMatchObject({ role: "system", notice: { reason: "session_interrupted" } });
});

test("keeps exact runtime times and skips a turn whose message text changed", () => {
  const exact: AgentSessionHistoryMessage = {
    ...user("u1", "Hi"),
    timestamp: "2026-11-22T09:00:00.000Z",
  };
  delete exact.timestampIsApproximate;
  const history = [exact, reply("a1"), user("u2", "Changed")];

  const merged = applySavedTurns(
    history,
    [
      turn({
        end: {
          completedAt: "2026-11-22T10:00:05.000Z",
          outcome: "completed",
          finalMessageId: "a1",
        },
      }),
      turn({ userMessageId: "u2", userMessageHash: agentSessionMessageFingerprint("Original") }),
    ],
    true,
  );

  expect(merged[0]).toEqual(exact);
  expect(merged[1]).toMatchObject({ timestamp: "2026-11-22T10:00:05.000Z" });
  expect(merged[2]).toEqual(history[2]);
});
