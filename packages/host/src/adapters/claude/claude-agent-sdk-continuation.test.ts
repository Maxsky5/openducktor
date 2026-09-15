import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { assertClaudePersistedContinuationEligible } from "./claude-agent-sdk-continuation";

const userMessage = (messageId: string): AgentSessionHistoryMessage => ({
  messageId,
  role: "user",
  timestamp: "2026-07-17T10:01:00.000Z",
  text: "Write the tests.",
  displayParts: [{ kind: "text", text: "Write the tests." }],
  state: "read",
  parts: [],
});

const assistantMessage = (
  messageId: string,
  finishReason?: string,
): AgentSessionHistoryMessage => ({
  messageId,
  role: "assistant",
  timestamp: "2026-07-17T10:01:01.000Z",
  text: "Working.",
  parts:
    finishReason === undefined
      ? []
      : [
          {
            kind: "step",
            messageId,
            partId: `${messageId}:finish`,
            phase: "finish",
            reason: finishReason,
          },
        ],
});

describe("assertClaudePersistedContinuationEligible", () => {
  test("accepts a transcript whose latest user turn has no final assistant result", () => {
    expect(() =>
      assertClaudePersistedContinuationEligible(
        [userMessage("user-1"), assistantMessage("assistant-1"), userMessage("user-2")],
        "session-1",
      ),
    ).not.toThrow();
  });

  test("accepts a transcript whose latest turn never finished", () => {
    expect(() =>
      assertClaudePersistedContinuationEligible(
        [
          userMessage("user-1"),
          assistantMessage("assistant-1", "stop"),
          userMessage("user-2"),
          assistantMessage("assistant-2", "end_turn"),
        ],
        "session-1",
      ),
    ).not.toThrow();
  });

  test("rejects a transcript without any user turn", () => {
    expect(() =>
      assertClaudePersistedContinuationEligible([assistantMessage("assistant-1")], "session-1"),
    ).toThrow("Claude session 'session-1' has no unfinished user turn to continue.");
  });

  test("rejects a transcript whose latest turn has a final assistant result", () => {
    expect(() =>
      assertClaudePersistedContinuationEligible(
        [userMessage("user-1"), assistantMessage("assistant-1", "stop")],
        "session-1",
      ),
    ).toThrow("Claude session 'session-1' has a final assistant result.");
  });
});
