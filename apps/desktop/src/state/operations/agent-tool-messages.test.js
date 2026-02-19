import { describe, expect, test } from "bun:test";
import { settleDanglingTodoToolMessages } from "./agent-tool-messages";

const baseTodoToolMessage = (overrides = {}) => ({
  id: "tool:1",
  role: "tool",
  content: "Tool todowrite running...",
  timestamp: "2026-02-19T00:00:00.000Z",
  meta: {
    kind: "tool",
    partId: "part-1",
    callId: "call-1",
    tool: "todowrite",
    status: "running",
    startedAtMs: 1000,
  },
  ...overrides,
});

describe("settleDanglingTodoToolMessages", () => {
  test("returns same reference when there are no dangling todo tools", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "done",
        timestamp: "2026-02-19T00:00:01.000Z",
      },
    ];
    const next = settleDanglingTodoToolMessages(messages, "2026-02-19T00:00:02.000Z");
    expect(next).toBe(messages);
  });

  test("marks dangling todowrite rows as completed and sets endedAt", () => {
    const messages = [baseTodoToolMessage()];
    const next = settleDanglingTodoToolMessages(messages, "2026-02-19T00:00:02.500Z");
    expect(next).not.toBe(messages);
    const toolMessage = next[0];
    expect(toolMessage?.meta?.kind).toBe("tool");
    if (toolMessage?.meta?.kind !== "tool") {
      throw new Error("Expected tool metadata");
    }
    expect(toolMessage.meta.status).toBe("completed");
    expect(toolMessage.meta.endedAtMs).toBe(Date.parse("2026-02-19T00:00:02.500Z"));
    expect(toolMessage.content).toContain("completed");
  });

  test("can settle dangling todo rows as error", () => {
    const messages = [baseTodoToolMessage()];
    const next = settleDanglingTodoToolMessages(messages, "2026-02-19T00:00:03.000Z", {
      outcome: "error",
      errorMessage: "Session failed",
    });
    const toolMessage = next[0];
    expect(toolMessage?.meta?.kind).toBe("tool");
    if (toolMessage?.meta?.kind !== "tool") {
      throw new Error("Expected tool metadata");
    }
    expect(toolMessage.meta.status).toBe("error");
    expect(toolMessage.meta.error).toBe("Session failed");
    expect(toolMessage.content).toContain("failed");
  });

  test("does not modify non-todo running tool rows", () => {
    const messages = [
      {
        id: "tool:2",
        role: "tool",
        content: "Tool bash running...",
        timestamp: "2026-02-19T00:00:01.000Z",
        meta: {
          kind: "tool",
          partId: "part-2",
          callId: "call-2",
          tool: "bash",
          status: "running",
        },
      },
    ];
    const next = settleDanglingTodoToolMessages(messages, "2026-02-19T00:00:04.000Z");
    expect(next).toBe(messages);
  });
});
