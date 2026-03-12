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
  test("derives preview hints for current tool families", () => {
    const scenarios = [
      {
        label: "shell",
        part: createToolPart({
          id: "preview-shell",
          tool: "bash",
          status: "running",
          input: { command: "bun run test --filter @openducktor/desktop" },
          title: "Run desktop tests",
        }),
        expectedPreview: "bun run test --filter @openducktor/desktop",
      },
      {
        label: "skill",
        part: createToolPart({
          id: "preview-skill",
          tool: "skill",
          status: "completed",
          input: { name: "clean-ddd-hexagonal" },
          output: "loaded skill output",
        }),
        expectedPreview: "clean-ddd-hexagonal",
      },
      {
        label: "odt read task",
        part: createToolPart({
          id: "preview-odt-read",
          tool: "odt_read_task",
          status: "completed",
          input: { taskId: "task-77" },
          output: {
            task: {
              id: "task-77",
              title: "Improve chat tool previews",
            },
          },
        }),
        expectedPreview: "task-77",
      },
      {
        label: "question",
        part: createToolPart({
          id: "preview-question",
          tool: "question",
          status: "completed",
          input: {
            questions: [{ question: "Which runtime should we use?" }],
          },
        }),
        expectedPreview: "Which runtime should we use?",
      },
      {
        label: "web",
        part: createToolPart({
          id: "preview-web",
          tool: "webfetch",
          status: "completed",
          input: { url: "https://example.com/docs" },
        }),
        expectedPreview: "https://example.com/docs",
      },
      {
        label: "context7",
        part: createToolPart({
          id: "preview-context7",
          tool: "context7_query-docs",
          status: "completed",
          input: {
            libraryId: "/vercel/next.js",
            query: "app router metadata examples",
          },
        }),
        expectedPreview: "app router metadata examples",
      },
    ] as const;

    for (const scenario of scenarios) {
      const mapped = mapPartToAgentStreamPart(scenario.part);
      expect(mapped).toBeTruthy();
      if (!mapped || mapped.kind !== "tool") {
        throw new Error(`Expected mapped tool part for ${scenario.label}.`);
      }
      expect(mapped.preview).toBe(scenario.expectedPreview);
    }
  });

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

  test("maps completed tool metadata structured error as tool error part", () => {
    const part = createToolPart({
      id: "tool-1b",
      tool: "openducktor_odt_set_spec",
      status: "completed",
      input: { taskId: "task-1" },
      output: "completed",
      metadata: {
        structuredContent: {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message:
              "set_spec is only allowed from open/spec_ready/ready_for_dev (current: in_progress)",
          },
        },
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1b",
      partId: "tool-1b",
      callId: "call-tool-1b",
      tool: "openducktor_odt_set_spec",
      status: "error",
      input: { taskId: "task-1" },
      error: "set_spec is only allowed from open/spec_ready/ready_for_dev (current: in_progress)",
      metadata: {
        structuredContent: {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message:
              "set_spec is only allowed from open/spec_ready/ready_for_dev (current: in_progress)",
          },
        },
      },
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
      preview: "1 todo",
      startedAtMs: 1,
      endedAtMs: 2,
    });
  });

  test("falls back to state timing when direct timing fields are non-numeric", () => {
    const part = {
      ...createToolPart({
        id: "tool-2b",
        status: "completed",
        input: {},
        time: {
          start: 111,
          end: 222,
        },
      }),
      time: {
        start: "invalid",
        end: "invalid",
      },
    } as unknown as Part;

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-2b",
      partId: "tool-2b",
      callId: "call-tool-2b",
      tool: "todowrite",
      status: "completed",
      input: {},
      startedAtMs: 111,
      endedAtMs: 222,
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

  test("prefers structured error message for tool parts already marked as error", () => {
    const part = createToolPart({
      id: "tool-4b",
      status: "error",
      input: {},
      error: "Generic failure",
      metadata: {
        structuredContent: {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message: "Specific structured failure",
          },
        },
      },
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-4b",
      partId: "tool-4b",
      callId: "call-tool-4b",
      tool: "todowrite",
      status: "error",
      input: {},
      error: "Specific structured failure",
      metadata: {
        structuredContent: {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message: "Specific structured failure",
          },
        },
      },
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
