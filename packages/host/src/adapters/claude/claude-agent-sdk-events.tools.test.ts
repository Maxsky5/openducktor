import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("handleClaudeSdkMessage tool events", () => {
  test("emits completed tool parts for Claude tool result user messages", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "mcp__openducktor__odt_set_plan",
              input: { taskId: "task-1" },
            },
          ],
        },
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: [{ type: "text", text: "plan saved" }],
        },
        message: {
          role: "user",
          content: [],
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          status: "pending",
          tool: "mcp__openducktor__odt_set_plan",
          toolType: "workflow",
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { taskId: "task-1" },
          messageId: "assistant-1",
          output: "plan saved",
          status: "completed",
          endedAtMs: Date.parse("2026-06-25T20:00:01.000Z"),
          tool: "mcp__openducktor__odt_set_plan",
          toolType: "workflow",
        }),
      }),
    ]);
  });

  test("emits completed tool parts for Claude MCP tool result content blocks", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "mcp_tool_use",
              id: "tool-1",
              name: "mcp__openducktor__odt_read_task",
              input: { taskId: "task-1" },
            },
          ],
        },
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        message: {
          role: "user",
          content: [
            {
              type: "mcp_tool_result",
              tool_use_id: "tool-1",
              content: [{ type: "text", text: "task loaded" }],
            },
          ],
        },
      }),
    });

    expect(events[1]).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { taskId: "task-1" },
          output: "task loaded",
          status: "completed",
          tool: "mcp__openducktor__odt_read_task",
          toolType: "workflow",
        }),
      }),
    );
  });

  test("does not invent generic tool rows for nameless orphan tool results", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "orphan-result-1",
        session_id: "session-1",
        parent_tool_use_id: "unknown-tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "unknown-tool-1",
          content: [{ type: "text", text: "unpaired output" }],
        },
        message: {
          role: "user",
          content: [],
        },
      }),
    });

    expect(events).toEqual([]);
  });

  test("emits errored tool parts for Claude tool result failures", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "exit 1" },
            },
          ],
        },
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:02.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-1",
          is_error: true,
          content: [{ type: "text", text: "command failed" }],
        },
        message: {
          role: "user",
          content: [],
        },
      }),
    });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          error: "command failed",
          input: { command: "exit 1" },
          messageId: "assistant-1",
          status: "error",
          endedAtMs: Date.parse("2026-06-25T20:00:02.000Z"),
          tool: "Bash",
          toolType: "bash",
        }),
      }),
    );
  });

  test("maps Claude MCP tool-use blocks with input metadata", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "mcp_tool_use",
              id: "tool-1",
              name: "mcp__openducktor__odt_read_task",
              server_name: "openducktor",
              input: { taskId: "task-1" },
            },
          ],
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          metadata: {
            blockType: "mcp_tool_use",
            serverName: "openducktor",
          },
          status: "pending",
          tool: "mcp__openducktor__odt_read_task",
          toolType: "workflow",
        }),
      }),
    ]);
  });

  test("matches SDK tool_use_id and tool_name fields across progress and results", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "server_tool_use",
              tool_use_id: "tool-1",
              tool_name: "Read",
              tool_input: { file_path: "apps/api/src/lib/auth.ts" },
            },
          ],
        },
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "tool_progress",
        uuid: "progress-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        tool_use_id: "tool-1",
        tool_name: "Read",
        elapsed_time_seconds: 3,
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:04.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-1",
          tool_name: "Read",
          content: [{ type: "text", text: "file contents" }],
        },
        message: {
          role: "user",
          content: [],
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          messageId: "assistant-1",
          status: "pending",
          tool: "Read",
          toolType: "read",
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { file_path: "apps/api/src/lib/auth.ts" },
          messageId: "assistant-1",
          status: "running",
          tool: "Read",
          toolType: "read",
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { file_path: "apps/api/src/lib/auth.ts" },
          messageId: "assistant-1",
          output: "file contents",
          startedAtMs: Date.parse("2026-06-25T20:00:00.000Z"),
          endedAtMs: Date.parse("2026-06-25T20:00:04.000Z"),
          status: "completed",
          tool: "Read",
          toolType: "read",
        }),
      }),
    ]);
  });

  test("times execution from tool progress instead of streamed tool generation", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude" as const,
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      emit,
      modelSelection,
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "stream-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: {},
          },
        },
      }),
    });

    handleClaudeSdkMessage({
      emit,
      modelSelection,
      session,
      timestamp: "2026-06-25T20:00:10.000Z",
      message: claudeSdkMessageFixture({
        type: "tool_progress",
        uuid: "progress-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        tool_use_id: "tool-1",
        tool_name: "Read",
        elapsed_time_seconds: 1,
      }),
    });

    handleClaudeSdkMessage({
      emit,
      modelSelection,
      session,
      timestamp: "2026-06-25T20:00:11.000Z",
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-1",
          tool_name: "Read",
          content: [{ type: "text", text: "file contents" }],
        },
        message: { role: "user", content: [] },
      }),
    });

    const toolParts = events.flatMap((event) =>
      event.type === "assistant_part" && event.part.kind === "tool" ? [event.part] : [],
    );
    expect(toolParts[0]).toMatchObject({ callId: "tool-1", status: "pending" });
    expect(toolParts[0]).not.toHaveProperty("startedAtMs");
    expect(toolParts[1]).toMatchObject({
      callId: "tool-1",
      startedAtMs: Date.parse("2026-06-25T20:00:09.000Z"),
      status: "running",
    });
    expect(toolParts[2]).toMatchObject({
      callId: "tool-1",
      endedAtMs: Date.parse("2026-06-25T20:00:11.000Z"),
      startedAtMs: Date.parse("2026-06-25T20:00:09.000Z"),
      status: "completed",
    });
  });

  test("omits execution timing when Claude provides no execution boundary", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const modelSelection = (model: string) => ({
      providerId: "claude" as const,
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      modelSelection,
      emit: (event) => events.push(event),
      timestamp: "2026-06-25T20:00:00.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-1", name: "Read", input: {} }],
        },
      }),
    });
    handleClaudeSdkMessage({
      session,
      modelSelection,
      emit: (event) => events.push(event),
      timestamp: "2026-06-25T20:00:05.000Z",
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        parent_tool_use_id: "tool-1",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "tool-1",
          tool_name: "Read",
          content: [{ type: "text", text: "file contents" }],
        },
        message: { role: "user", content: [] },
      }),
    });

    const completedPart = events.find(
      (event) =>
        event.type === "assistant_part" &&
        event.part.kind === "tool" &&
        event.part.status === "completed",
    );
    expect(completedPart).toBeDefined();
    if (completedPart?.type === "assistant_part") {
      expect(completedPart.part).not.toHaveProperty("startedAtMs");
    }
  });

  test("emits tool progress with runtime duration metadata", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.toolMessageIdsByCallId.set("tool-1", "assistant-1");
    session.toolInputsByCallId.set("tool-1", { command: "bun test" });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:10.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "tool_progress",
        uuid: "progress-1",
        session_id: "session-1",
        parent_tool_use_id: null,
        tool_use_id: "tool-1",
        tool_name: "Bash",
        elapsed_time_seconds: 4.25,
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          input: { command: "bun test" },
          messageId: "assistant-1",
          metadata: {
            elapsedTimeSeconds: 4.25,
            durationMs: 4250,
          },
          startedAtMs: Date.parse("2026-06-25T20:00:05.750Z"),
          status: "running",
          tool: "Bash",
        }),
      }),
    ]);
  });

  test("ignores forwarded tool progress before its subagent task is known", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:10.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "tool_progress",
        uuid: "progress-1",
        session_id: "session-1",
        parent_tool_use_id: "agent-tool-1",
        tool_use_id: "subagent-tool-1",
        tool_name: "Bash",
        elapsed_time_seconds: 4.25,
      }),
    });

    expect(events).toEqual([]);
  });
});
