import type { Part } from "@opencode-ai/sdk/v2/client";
import { describe, expect, test } from "./bun-test";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";

describe("stream-part-mapper", () => {
  test("maps completed MCP tool output with isError as tool error part", () => {
    const part = {
      id: "tool-1",
      sessionID: "session-1",
      messageID: "assistant-1",
      callID: "call-1",
      type: "tool",
      tool: "openducktor_odt_set_spec",
      state: {
        status: "completed",
        input: { taskId: "task-1" },
        output: {
          content: [{ type: "text", text: "Task not found" }],
          isError: true,
        },
        metadata: {
          scope: "mcp",
        },
        time: {
          start: 100,
          end: 130,
        },
      },
    } as unknown as Part;

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toMatchObject({
      kind: "tool",
      status: "error",
      error: "Task not found",
      startedAtMs: 100,
      endedAtMs: 130,
    });
  });

  test("maps pending tool with end timing as completed", () => {
    const part = {
      id: "tool-2",
      sessionID: "session-1",
      messageID: "assistant-2",
      callID: "call-2",
      type: "tool",
      tool: "todowrite",
      state: {
        status: "pending",
        input: {
          todos: [{ id: "todo-1", content: "A" }],
        },
        time: {
          start: 1,
          end: 2,
        },
      },
    } as unknown as Part;

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toMatchObject({
      kind: "tool",
      status: "completed",
      startedAtMs: 1,
      endedAtMs: 2,
    });
  });

  test("returns null for unsupported part type", () => {
    const part = {
      id: "unknown-1",
      sessionID: "session-1",
      messageID: "assistant-1",
      type: "unknown",
    } as unknown as Part;

    expect(mapPartToAgentStreamPart(part)).toBeNull();
  });
});
