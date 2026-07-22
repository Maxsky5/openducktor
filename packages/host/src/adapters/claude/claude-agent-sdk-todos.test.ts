import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import {
  claudeHistoryMessageFixtures,
  claudeSdkMessageFixture,
} from "./claude-agent-sdk-test-messages";
import { applyClaudeTaskToolResult, toClaudeTodos } from "./claude-agent-sdk-todos";

const timestamp = "2026-07-20T19:28:50.000Z";

const taskCreateMessages = () => {
  const toolUse = claudeSdkMessageFixture({
    type: "assistant",
    uuid: "assistant-create",
    session_id: "session-1",
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-create",
          name: "TaskCreate",
          input: {
            subject: "Implement Facebook auth",
            description: "Add the provider configuration",
          },
        },
      ],
      stop_reason: "tool_use",
    },
  });
  const toolResult = claudeSdkMessageFixture({
    type: "user",
    uuid: "result-create",
    session_id: "session-1",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-create",
          content: "Task #1 created successfully",
        },
      ],
    },
    tool_use_result: {
      task: {
        id: "1",
        subject: "Implement Facebook auth",
      },
    },
  });
  return { toolResult, toolUse };
};

describe("Claude task tools", () => {
  test("emits canonical TODO updates from live TaskCreate and TaskUpdate results", () => {
    const events: AgentEvent[] = [];
    const session = createEventTestSession();
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });
    const { toolResult, toolUse } = taskCreateMessages();

    handleClaudeSdkMessage({
      emit: (event) => events.push(event),
      message: toolUse,
      modelSelection,
      session,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit: (event) => events.push(event),
      message: toolResult,
      modelSelection,
      session,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-update",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-update",
              name: "TaskUpdate",
              input: {
                taskId: "1",
                status: "in_progress",
                subject: "Implement Facebook auth configuration",
              },
            },
          ],
          stop_reason: "tool_use",
        },
      }),
      modelSelection,
      session,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "result-update",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-update",
              content: "Updated task #1 status",
            },
          ],
        },
        tool_use_result: {
          success: true,
          taskId: "1",
          updatedFields: ["status", "subject"],
          statusChange: { from: "pending", to: "in_progress" },
        },
      }),
      modelSelection,
      session,
      timestamp,
    });

    expect(events.filter((event) => event.type === "session_todos_updated")).toEqual([
      {
        type: "session_todos_updated",
        externalSessionId: "session-1",
        timestamp,
        todos: [
          {
            id: "1",
            content: "Implement Facebook auth",
            status: "pending",
            priority: "medium",
          },
        ],
      },
      {
        type: "session_todos_updated",
        externalSessionId: "session-1",
        timestamp,
        todos: [
          {
            id: "1",
            content: "Implement Facebook auth configuration",
            status: "in_progress",
            priority: "medium",
          },
        ],
      },
    ]);

    expect(
      events.flatMap((event) => {
        if (
          event.type !== "assistant_part" ||
          event.part.kind !== "tool" ||
          (event.part.tool !== "TaskCreate" && event.part.tool !== "TaskUpdate")
        ) {
          return [];
        }
        return [
          {
            displayLabel: event.part.displayLabel,
            status: event.part.status,
            tool: event.part.tool,
          },
        ];
      }),
    ).toEqual([
      { displayLabel: "todo", status: "pending", tool: "TaskCreate" },
      { displayLabel: "todo", status: "completed", tool: "TaskCreate" },
      { displayLabel: "todo", status: "pending", tool: "TaskUpdate" },
      { displayLabel: "todo", status: "completed", tool: "TaskUpdate" },
    ]);

    expect(
      events
        .filter(
          (event) =>
            event.type === "assistant_part" &&
            event.part.kind === "tool" &&
            event.part.status === "completed",
        )
        .map((event) => (event.type === "assistant_part" ? event.part : null)),
    ).toEqual([
      expect.objectContaining({
        tool: "TaskCreate",
        toolType: "todo",
        displayLabel: "todo",
        input: {
          todos: [{ step: "Implement Facebook auth", status: "pending" }],
        },
        output: "Plan updated",
      }),
      expect.objectContaining({
        tool: "TaskUpdate",
        toolType: "todo",
        displayLabel: "todo",
        input: {
          todos: [
            {
              step: "Implement Facebook auth configuration",
              status: "in_progress",
            },
          ],
        },
        output: "Plan updated",
      }),
    ]);
  });

  test("rebuilds the same TODO state from SDK-imported history", () => {
    const { toolResult, toolUse } = taskCreateMessages();
    const updateUse = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "assistant-update",
      session_id: "session-1",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-update",
            name: "TaskUpdate",
            input: { taskId: "1", status: "completed" },
          },
        ],
        stop_reason: "tool_use",
      },
    });
    const updateResult = claudeSdkMessageFixture({
      type: "user",
      uuid: "result-update",
      session_id: "session-1",
      parent_tool_use_id: "tool-update",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-update",
            content: "Updated task #1 status",
          },
        ],
      },
      tool_use_result: {
        success: true,
        taskId: "1",
        updatedFields: ["status"],
        statusChange: { from: "pending", to: "completed" },
      },
    });

    const historyMessages = claudeHistoryMessageFixtures([
      toolUse,
      toolResult,
      updateUse,
      updateResult,
    ]);
    expect(toClaudeTodos(historyMessages)).toEqual([
      {
        id: "1",
        content: "Implement Facebook auth",
        status: "completed",
        priority: "medium",
      },
    ]);
    expect(
      toClaudeHistoryMessages(historyMessages, () => timestamp)
        .flatMap((message) => message.parts)
        .filter((part) => part.kind === "tool" && part.status === "completed"),
    ).toEqual([
      expect.objectContaining({
        tool: "TaskCreate",
        toolType: "todo",
        displayLabel: "todo",
        input: {
          todos: [{ step: "Implement Facebook auth", status: "pending" }],
        },
        output: "Plan updated",
      }),
      expect.objectContaining({
        tool: "TaskUpdate",
        toolType: "todo",
        displayLabel: "todo",
        input: {
          todos: [{ step: "Implement Facebook auth", status: "completed" }],
        },
        output: "Plan updated",
      }),
    ]);
  });

  test("uses TaskList as the authoritative task snapshot", () => {
    const listUse = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "assistant-list",
      session_id: "session-1",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-list", name: "TaskList", input: {} }],
        stop_reason: "tool_use",
      },
    });
    const listResult = claudeSdkMessageFixture({
      type: "user",
      uuid: "result-list",
      session_id: "session-1",
      parent_tool_use_id: "tool-list",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-list", content: "2 tasks" }],
      },
      tool_use_result: {
        tasks: [
          { id: "2", subject: "Run tests", status: "in_progress", blockedBy: [] },
          { id: "3", subject: "Commit", status: "pending", blockedBy: ["2"] },
        ],
      },
    });

    expect(toClaudeTodos(claudeHistoryMessageFixtures([listUse, listResult]))).toEqual([
      { id: "2", content: "Run tests", status: "in_progress", priority: "medium" },
      { id: "3", content: "Commit", status: "pending", priority: "medium" },
    ]);
  });

  test("removes tasks deleted by TaskUpdate", () => {
    const state = new Map([
      [
        "1",
        {
          id: "1",
          content: "Obsolete task",
          status: "pending" as const,
          priority: "medium" as const,
        },
      ],
    ]);

    expect(
      applyClaudeTaskToolResult({
        input: { taskId: "1", status: "deleted" },
        isError: false,
        raw: {
          toolUseResult: {
            success: true,
            taskId: "1",
            updatedFields: ["status"],
          },
        },
        state,
        tool: "TaskUpdate",
      }),
    ).toEqual([]);
  });
});
