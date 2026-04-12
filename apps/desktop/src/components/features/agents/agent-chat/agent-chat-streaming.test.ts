import { describe, expect, test } from "bun:test";
import { resolveActiveStreamingAssistantMessageId } from "./agent-chat-streaming";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";

describe("resolveActiveStreamingAssistantMessageId", () => {
  test("returns the trailing non-final assistant row while a session is running", () => {
    const session = buildSession({
      status: "running",
      messages: [
        buildMessage("assistant", "Still working", {
          id: "assistant-live",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
          },
        }),
      ],
      pendingQuestions: [],
    });

    expect(resolveActiveStreamingAssistantMessageId(session)).toBe("assistant-live");
  });

  test("treats non-final assistant rows as stable once later transcript rows exist", () => {
    const session = buildSession({
      status: "running",
      messages: [
        buildMessage("assistant", "Let me inspect the code.", {
          id: "assistant-intermediate",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
          },
        }),
        buildMessage("tool", "Tool read completed", {
          id: "tool-1",
          meta: {
            kind: "tool",
            partId: "part-1",
            callId: "call-1",
            tool: "read",
            status: "completed",
          },
        }),
      ],
      pendingQuestions: [],
    });

    expect(resolveActiveStreamingAssistantMessageId(session)).toBeNull();
  });

  test("does not mark non-final assistant rows as streaming after the session stops", () => {
    const session = buildSession({
      status: "idle",
      messages: [
        buildMessage("assistant", "Intermediate summary", {
          id: "assistant-history",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
          },
        }),
      ],
      pendingQuestions: [],
    });

    expect(resolveActiveStreamingAssistantMessageId(session)).toBeNull();
  });
});
