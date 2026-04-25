import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  isStopAbortSessionErrorMessage,
  normalizeRetryStatusMessage,
  normalizeSessionErrorMessage,
  resolveToolMessageId,
} from "./tool-messages";

const createSession = (messages: AgentChatMessage[]) => ({
  sessionId: "session-1",
  messages,
});

describe("agent-orchestrator/support/tool-messages", () => {
  test("resolves tool message ids by callId and running fallback", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "tool:m1:old",
        role: "tool",
        content: "running",
        timestamp: "2026-02-22T08:00:00.000Z",
        meta: {
          kind: "tool",
          partId: "old",
          callId: "call-1",
          tool: "todowrite",
          status: "running",
        },
      },
    ];

    const byCallId = resolveToolMessageId(
      createSession(messages),
      {
        messageId: "m2",
        callId: "call-1",
        tool: "todowrite",
        status: "completed",
      },
      "tool:m2:new",
    );

    expect(byCallId).toBe("tool:m1:old");
  });

  test("normalizes session and retry error messages", () => {
    expect(normalizeSessionErrorMessage('{"message":"Oops"}')).toBe("Oops");
    expect(normalizeRetryStatusMessage('{"message":"Retrying"}')).toBe("Retrying");
  });

  test("classifies intentional stop abort variants narrowly", () => {
    expect(isStopAbortSessionErrorMessage("Aborted")).toBe(true);
    expect(isStopAbortSessionErrorMessage('"Aborted"')).toBe(true);
    expect(isStopAbortSessionErrorMessage('{"message":"Request cancelled by user"}')).toBe(true);
    expect(isStopAbortSessionErrorMessage('{"error":{"message":"Operation canceled"}}')).toBe(true);
    expect(isStopAbortSessionErrorMessage("Permission denied")).toBe(false);
    expect(isStopAbortSessionErrorMessage("boom")).toBe(false);
  });
});
