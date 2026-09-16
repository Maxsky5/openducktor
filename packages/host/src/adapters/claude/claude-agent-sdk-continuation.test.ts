import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import {
  assertClaudeContinuationEligible,
  assertClaudePersistedContinuationEligible,
  claudeLiveContinuationNeedsTranscript,
} from "./claude-agent-sdk-continuation";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";

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

const acceptedUserMessage = (messageId: string) => ({
  messageId,
  parts: [],
  text: "Continue.",
  timestamp: "2026-06-25T20:00:01.000Z",
});

describe("assertClaudeContinuationEligible", () => {
  test("rejects a completed latest in-process turn as completed_turn", () => {
    const session = createClaudeSession({
      acceptedUserMessages: [acceptedUserMessage("user-1")],
      lastAssistantTextFinal: true,
      lastAssistantTextTurnIndex: 1,
    });

    expect(() => assertClaudeContinuationEligible(session, "session-1")).toThrow(
      "Claude session 'session-1' has a final assistant result.",
    );
  });

  test("accepts an unfinished latest turn after an earlier final result", () => {
    const session = createClaudeSession({
      acceptedUserMessages: [acceptedUserMessage("user-1"), acceptedUserMessage("user-2")],
      lastAssistantTextFinal: true,
      lastAssistantTextTurnIndex: 1,
    });

    expect(() => assertClaudeContinuationEligible(session, "session-1")).not.toThrow();
  });
});

describe("claudeLiveContinuationNeedsTranscript", () => {
  test("requires the transcript when the session accepted no user turn", () => {
    expect(claudeLiveContinuationNeedsTranscript(createClaudeSession())).toBe(true);
  });

  test("keeps the live decision when the session accepted a user turn", () => {
    expect(
      claudeLiveContinuationNeedsTranscript(
        createClaudeSession({ acceptedUserMessages: [acceptedUserMessage("user-1")] }),
      ),
    ).toBe(false);
  });
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
