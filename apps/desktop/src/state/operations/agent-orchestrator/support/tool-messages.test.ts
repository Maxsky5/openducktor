import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  normalizeRetryStatusMessage,
  normalizeSessionErrorMessage,
  resolveToolMessageId,
} from "./tool-messages";

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
      messages,
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
});
