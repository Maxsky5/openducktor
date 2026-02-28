import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";
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

  test("maps started tool without end timing as running and keeps title", () => {
    const part = {
      id: "tool-3",
      sessionID: "session-1",
      messageID: "assistant-3",
      callID: "call-3",
      type: "tool",
      tool: "todowrite",
      state: {
        status: "started",
        input: {},
        title: "Working",
        time: {
          start: 25,
        },
      },
    } as unknown as Part;

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toMatchObject({
      kind: "tool",
      status: "running",
      title: "Working",
      startedAtMs: 25,
    });
  });

  test("maps failed tool status as error", () => {
    const part = {
      id: "tool-4",
      sessionID: "session-1",
      messageID: "assistant-4",
      callID: "call-4",
      type: "tool",
      tool: "todowrite",
      state: {
        status: "failed",
        input: {},
        error: "Execution failed",
      },
    } as unknown as Part;

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toMatchObject({
      kind: "tool",
      status: "error",
      error: "Execution failed",
    });
  });

  test("maps unknown tool status with end timing as completed", () => {
    const part = {
      id: "tool-5",
      sessionID: "session-1",
      messageID: "assistant-5",
      callID: "call-5",
      type: "tool",
      tool: "todowrite",
      state: {
        status: "unknown",
        input: {},
        time: {
          start: 10,
          end: 12,
        },
      },
    } as unknown as Part;

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toMatchObject({
      kind: "tool",
      status: "completed",
      startedAtMs: 10,
      endedAtMs: 12,
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
