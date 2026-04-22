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
  test("maps raw subtask parts to canonical subagent parts", () => {
    const part = {
      id: "subtask-1",
      sessionID: "session-1",
      messageID: "assistant-subtask-1",
      type: "subtask",
      agent: "build",
      prompt: "Implement the plan",
      description: "Implement the plan",
      model: "gpt-5",
      command: "build",
    } as unknown as Part;

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toEqual({
      kind: "subagent",
      messageId: "assistant-subtask-1",
      partId: "subtask-1",
      correlationKey: "spawn:assistant-subtask-1:build:Implement the plan",
      status: "running",
      agent: "build",
      prompt: "Implement the plan",
      description: "Implement the plan",
      metadata: {
        model: "gpt-5",
        command: "build",
      },
    });
  });

  test("maps subagent tool families to canonical subagent parts", () => {
    const part = createToolPart({
      id: "tool-subagent-1",
      tool: "delegate",
      status: "completed",
      input: {
        agent: "planner",
        prompt: "Inspect the tests",
      },
      output: {
        result: "Done subtask",
        sessionId: "session-child-1",
      },
      metadata: {
        background: true,
        summary: [{ id: 1 }],
      },
      time: {
        start: 10,
        end: 40,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toEqual({
      kind: "subagent",
      messageId: "assistant-tool-subagent-1",
      partId: "tool-subagent-1",
      correlationKey: "spawn:assistant-tool-subagent-1:planner:Inspect the tests",
      status: "completed",
      agent: "planner",
      prompt: "Inspect the tests",
      description: "Done subtask",
      sessionId: "session-child-1",
      executionMode: "background",
      metadata: {
        background: true,
        summary: [{ id: 1 }],
      },
      startedAtMs: 10,
      endedAtMs: 40,
    });
  });

  test("maps task tool parts with metadata session ids to canonical subagent parts", () => {
    const part = createToolPart({
      id: "tool-task-1",
      tool: "task",
      status: "running",
      input: {
        subagent_type: "build",
        prompt: "Inspect the repo",
        description: "Starting subagent",
      },
      metadata: {
        sessionId: "session-child-task-1",
      },
      time: {
        start: 25,
      },
    });

    const mapped = mapPartToAgentStreamPart(part);

    expect(mapped).toEqual({
      kind: "subagent",
      messageId: "assistant-tool-task-1",
      partId: "tool-task-1",
      correlationKey: "spawn:assistant-tool-task-1:build:Inspect the repo",
      status: "running",
      agent: "build",
      prompt: "Inspect the repo",
      description: "Starting subagent",
      sessionId: "session-child-task-1",
      metadata: {
        sessionId: "session-child-task-1",
      },
      startedAtMs: 25,
    });
  });

  test("keeps the same correlation key when tool completion changes the description", () => {
    const spawnPart = {
      id: "subtask-identity-1",
      sessionID: "session-1",
      messageID: "assistant-identity-1",
      type: "subtask",
      agent: "build",
      prompt: "Inspect the repo",
      description: "Starting work",
    } as unknown as Part;

    const completionPart = {
      id: "tool-identity-1",
      sessionID: "session-1",
      messageID: "assistant-identity-1",
      callID: "call-identity-1",
      type: "tool",
      tool: "delegate",
      state: {
        status: "completed",
        input: {
          agent: "build",
          prompt: "Inspect the repo",
        },
        output: {
          result: "Finished work",
          sessionId: "session-child-identity-1",
        },
      },
    } as unknown as Part;

    const spawned = mapPartToAgentStreamPart(spawnPart);
    const completed = mapPartToAgentStreamPart(completionPart);

    if (!spawned || spawned.kind !== "subagent") {
      throw new Error("Expected spawned subagent part");
    }
    if (!completed || completed.kind !== "subagent") {
      throw new Error("Expected completed subagent part");
    }

    expect(spawned.correlationKey).toBe("spawn:assistant-identity-1:build:Inspect the repo");
    expect(completed.correlationKey).toBe("spawn:assistant-identity-1:build:Inspect the repo");
    expect(completed.description).toBe("Finished work");
    expect(completed.sessionId).toBe("session-child-identity-1");
  });

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
      preview: "task-1",
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
      preview: "task-1",
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

  test("maps completed tool output containing flattened structured error JSON as tool error part", () => {
    const part = createToolPart({
      id: "tool-1c",
      tool: "openducktor_odt_set_plan",
      status: "completed",
      input: { taskId: "task-7" },
      output: JSON.stringify(
        {
          ok: false,
          error: {
            code: "ODT_TOOL_EXECUTION_ERROR",
            message: "Only epics can receive subtask proposals during planning.",
          },
        },
        null,
        2,
      ),
    });

    const mapped = mapPartToAgentStreamPart(part);
    expect(mapped).toEqual({
      kind: "tool",
      messageId: "assistant-tool-1c",
      partId: "tool-1c",
      callId: "call-tool-1c",
      tool: "openducktor_odt_set_plan",
      status: "error",
      input: { taskId: "task-7" },
      preview: "task-7",
      error: "Only epics can receive subtask proposals during planning.",
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
