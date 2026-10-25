import { normalizeSessionErrorMessage } from "../../../lib/session-error-message";
import { describe, expect, test } from "bun:test";
import { createSessionMessagesFixture } from "../../../test-support/session-message-test-helpers";
import type { AgentChatMessage } from "../../../types/agent-orchestrator";
import {
  isStopAbortSessionErrorMessage,
  normalizeRetryStatusMessage,
  resolveToolMessageId,
} from "./tool-messages";

const createSession = (messages: AgentChatMessage[]) => ({
  externalSessionId: "session-1",
  messages: createSessionMessagesFixture("session-1", messages),
});

describe("agent-orchestrator/support/tool-messages", () => {
  test.each([
    ["call ID", "m2", "call-1"],
    ["message ID without a call ID", "m1", ""],
    ["tool name without a call ID", "m2", ""],
  ])("resolves tool message ids by %s", (_match, messageId, callId) => {
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
          toolType: "todo",
          status: "running",
        },
      },
    ];

    const resolvedId = resolveToolMessageId(
      createSession(messages),
      {
        messageId,
        callId,
        tool: "todowrite",
        status: "completed",
      },
      "tool:m2:new",
    );

    expect(resolvedId).toBe("tool:m1:old");
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
