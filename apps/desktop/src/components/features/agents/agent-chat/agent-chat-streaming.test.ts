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

  test("keeps tracking a live non-final assistant row after later tool rows are appended", () => {
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

    expect(resolveActiveStreamingAssistantMessageId(session)).toBe("assistant-intermediate");
  });

  test("keeps tracking a live non-final assistant row after later subagent rows are appended", () => {
    const session = buildSession({
      status: "running",
      messages: [
        buildMessage("assistant", "Drafting the plan", {
          id: "assistant-subtask-live",
          meta: {
            kind: "assistant",
            agentRole: "build",
            isFinal: false,
          },
        }),
        buildMessage("system", "Subagent (planner): inspect tests", {
          id: "subagent:planner-1",
          meta: {
            kind: "subagent",
            partId: "part-subtask-1",
            correlationKey: "spawn:assistant-subtask-live:planner:Inspect the tests:inspect tests",
            status: "running",
            agent: "planner",
            prompt: "Inspect the tests",
            description: "inspect tests",
          },
        }),
      ],
      pendingQuestions: [],
    });

    expect(resolveActiveStreamingAssistantMessageId(session)).toBe("assistant-subtask-live");
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
