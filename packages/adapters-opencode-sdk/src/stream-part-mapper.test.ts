import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";

const createToolPart = ({
  id,
  status,
  input = {},
  output,
  error,
  title,
  metadata,
  time,
  tool = "todowrite",
}: {
  id: string;
  status?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: unknown;
  title?: unknown;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
  tool?: string;
}): Part => {
  const state: Record<string, unknown> = {
    input,
  };

  if (status !== undefined) {
    state.status = status;
  }
  if (output !== undefined) {
    state.output = output;
  }
  if (error !== undefined) {
    state.error = error;
  }
  if (title !== undefined) {
    state.title = title;
  }
  if (metadata !== undefined) {
    state.metadata = metadata;
  }
  if (time !== undefined) {
    state.time = time;
  }

  return {
    id,
    sessionID: "session-1",
    messageID: `assistant-${id}`,
    callID: `call-${id}`,
    type: "tool",
    tool,
    state,
  } as unknown as Part;
};

describe("stream-part-mapper", () => {
  test("maps completed MCP tool output with isError as tool error part and omits title", () => {
    const part = createToolPart({
      id: "tool-1",
      tool: "openducktor_odt_set_spec",
      status: "completed",
      input: { taskId: "task-1" },
      output: {
        content: [{ type: "text", text: "Task not found" }],
        isError: true,
      },
      metadata: {
        scope: "mcp",
      },
      title: "Spec write",
      time: {
        start: 100,
        end: 130,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1",
      partId: "tool-1",
      callId: "call-tool-1",
      tool: "openducktor_odt_set_spec",
      status: "error",
      input: { taskId: "task-1" },
      error: "Task not found",
      metadata: {
        scope: "mcp",
      },
      startedAtMs: 100,
      endedAtMs: 130,
    });
  });

  test("maps pending tool with end timing as completed", () => {
    const part = createToolPart({
      id: "tool-2",
      status: "pending",
      input: {
        todos: [{ id: "todo-1", content: "A" }],
      },
      time: {
        start: 1,
        end: 2,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-2",
      partId: "tool-2",
      callId: "call-tool-2",
      tool: "todowrite",
      status: "completed",
      input: {
        todos: [{ id: "todo-1", content: "A" }],
      },
      startedAtMs: 1,
      endedAtMs: 2,
    });
  });

  test("maps started tool without end timing as running and keeps title", () => {
    const part = createToolPart({
      id: "tool-3",
      status: "started",
      input: {},
      title: "Working",
      time: {
        start: 25,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-3",
      partId: "tool-3",
      callId: "call-tool-3",
      tool: "todowrite",
      status: "running",
      input: {},
      title: "Working",
      startedAtMs: 25,
    });
  });

  test("maps failed tool status as error without title field", () => {
    const part = createToolPart({
      id: "tool-4",
      status: "failed",
      input: {},
      title: "Failure title",
      error: "Execution failed",
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-4",
      partId: "tool-4",
      callId: "call-tool-4",
      tool: "todowrite",
      status: "error",
      input: {},
      error: "Execution failed",
    });
  });

  test("normalizes tool statuses across known and fallback values", () => {
    const scenarios = [
      { rawStatus: "completed", hasEndedTiming: false, expectedStatus: "completed" },
      { rawStatus: "completed", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "error", hasEndedTiming: false, expectedStatus: "error" },
      { rawStatus: "failed", hasEndedTiming: false, expectedStatus: "error" },
      { rawStatus: "pending", hasEndedTiming: false, expectedStatus: "pending" },
      { rawStatus: "pending", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "running", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "running", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "started", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "started", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "unknown", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "unknown", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "", hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: undefined, hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: undefined, hasEndedTiming: true, expectedStatus: "completed" },
      { rawStatus: "   ", hasEndedTiming: false, expectedStatus: "running" },
      { rawStatus: "   ", hasEndedTiming: true, expectedStatus: "completed" },
    ] as const;

    for (const [index, scenario] of scenarios.entries()) {
      const part = createToolPart({
        id: `status-${index}`,
        status: scenario.rawStatus,
        time: scenario.hasEndedTiming ? { start: 1, end: 2 } : { start: 1 },
      });
      const mapped = mapPartToAgentStreamPart(part);

      expect(mapped).toBeTruthy();
      if (!mapped || mapped.kind !== "tool") {
        throw new Error("Expected mapped tool part.");
      }
      expect(mapped.status).toBe(scenario.expectedStatus);
    }
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
