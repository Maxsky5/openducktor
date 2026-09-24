import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentStreamPart } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { hasActiveClaudeBackgroundWork } from "./claude-agent-sdk-event-session";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { filterClaudeHistoryMessages } from "./claude-agent-sdk-history-import";
import {
  claudeSdkMessageFixture,
  claudeSessionMessageFixture,
} from "./claude-agent-sdk-test-messages";

type ToolPart = Extract<AgentStreamPart, { kind: "tool" }>;
const timestamp = "2026-09-24T20:00:00.000Z";

const live = () => {
  const session = createEventTestSession();
  const events: AgentEvent[] = [];
  const send = (message: Parameters<typeof handleClaudeSdkMessage>[0]["message"], at = timestamp) =>
    handleClaudeSdkMessage({
      emit: (event) => events.push(event),
      message,
      modelSelection: (model) => ({ modelId: model, providerId: "claude", runtimeKind: "claude" }),
      session,
      timestamp: at,
    });
  const parts = (callId: string): ToolPart[] =>
    events.flatMap((event) =>
      event.type === "assistant_part" && event.part.kind === "tool" && event.part.callId === callId
        ? [event.part]
        : [],
    );
  return { events, parts, send, session };
};

const toolUse = (callId: string, name: string, input: Record<string, string | boolean> = {}) =>
  claudeSdkMessageFixture({
    type: "assistant",
    uuid: "b3f2889b-6b65-445e-b404-5fb8f18b7aa0",
    session_id: "session-1",
    message: { role: "assistant", content: [{ type: "tool_use", id: callId, name, input }] },
  });

const toolResult = (callId: string, content: string, backgroundTaskId?: string) => {
  const toolUseResult = backgroundTaskId
    ? { type: "tool_result", tool_use_id: callId, content, backgroundTaskId }
    : { type: "tool_result", tool_use_id: callId, content };
  return claudeSdkMessageFixture({
    type: "user",
    uuid: "46b4c9fc-354f-49f8-a6ed-afadf36b9095",
    session_id: "session-1",
    parent_tool_use_id: callId,
    tool_use_result: toolUseResult,
    message: { role: "user", content: [] },
  });
};

const taskStart = (taskId: string, callId: string, description: string, isBackgrounded = true) =>
  claudeSdkMessageFixture({
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: callId,
    task_type: "local_bash",
    is_backgrounded: isBackgrounded,
    description,
  });

const snapshot = (
  tasks: Array<{ task_id: string; description: string; task_type: string; ambient?: boolean }>,
) => claudeSdkMessageFixture({ type: "system", subtype: "background_tasks_changed", tasks });

const notification = (
  taskId: string,
  status: "completed" | "failed" | "stopped",
  summary: string,
) =>
  claudeSdkMessageFixture({
    type: "system",
    subtype: "task_notification",
    task_id: taskId,
    status,
    summary,
  });

describe("Claude background ordinary tool parts", () => {
  test("keeps the Bash call running after launch and shows progress and completion", () => {
    const { parts, send, session } = live();
    send(toolUse("bash-1", "Bash", { command: "sleep 10", run_in_background: true }));
    send(snapshot([{ task_id: "task-1", task_type: "local_bash", description: "Compile source" }]));
    send(taskStart("task-1", "bash-1", "Compile source"));
    send(toolResult("bash-1", "Command started", "task-1"));
    expect(parts("bash-1").at(-1)).toMatchObject({
      callId: "bash-1",
      partId: "bash-1",
      messageId: "b3f2889b-6b65-445e-b404-5fb8f18b7aa0",
      status: "running",
      input: { command: "sleep 10", run_in_background: true },
      metadata: { backgroundTaskId: "task-1" },
    });
    expect(hasActiveClaudeBackgroundWork(session)).toBe(true);
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_progress",
        task_id: "task-1",
        description: "Compile source",
        summary: "3 of 5 files done",
      }),
    );
    expect(parts("bash-1").at(-1)).toMatchObject({
      status: "running",
      output: "Compile source\n3 of 5 files done",
    });
    send(snapshot([]));
    expect(parts("bash-1").at(-1)).toMatchObject({
      status: "error",
      metadata: { backgroundTaskStatus: "unknown" },
    });
    expect(hasActiveClaudeBackgroundWork(session)).toBe(false);
    send(notification("task-1", "completed", "Build passed"));
    expect(parts("bash-1").at(-1)).toMatchObject({
      status: "completed",
      output: "Compile source\nBuild passed",
      metadata: { backgroundTaskStatus: "completed" },
    });
    expect(session.backgroundToolActiveTaskIds?.size).toBe(0);
    expect(parts("bash-1").every((part) => part.partId === "bash-1")).toBe(true);
  });

  test("keeps overlapping MCP and workflow calls separate, including failure and stop", () => {
    const { parts, send } = live();
    send(toolUse("mcp-1", "mcp__server__long_call", { query: "one" }));
    send(toolUse("workflow-1", "mcp__openducktor__odt_build_completed", { taskId: "task-1" }));
    send(
      snapshot([
        { task_id: "task-mcp", task_type: "mcp_task", description: "Fetch report" },
        { task_id: "task-workflow", task_type: "local_workflow", description: "Finish build" },
      ]),
    );
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "task-mcp",
        tool_use_id: "mcp-1",
        task_type: "mcp_task",
        description: "Fetch report",
      }),
    );
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "task-workflow",
        tool_use_id: "workflow-1",
        task_type: "local_workflow",
        description: "Finish build",
      }),
    );
    send(toolResult("mcp-1", "Running"));
    send(toolResult("workflow-1", "Running"));
    expect(parts("mcp-1").at(-1)?.status).toBe("running");
    expect(parts("workflow-1").at(-1)?.status).toBe("running");
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_updated",
        task_id: "task-mcp",
        patch: { status: "failed", error: "Server rejected query" },
      }),
    );
    send(notification("task-mcp", "failed", "Query failed"));
    send(notification("task-workflow", "stopped", "Stopped by user"));
    expect(parts("mcp-1").at(-1)).toMatchObject({
      status: "error",
      error: "Server rejected query",
      metadata: { backgroundTaskStatus: "failed" },
    });
    expect(parts("workflow-1").at(-1)).toMatchObject({
      status: "error",
      error: "Stopped: Stopped by user",
      metadata: { backgroundTaskStatus: "stopped" },
    });
  });

  test("ignores ambient and uncorrelated tasks and leaves foreground results completed", () => {
    const { events, parts, send, session } = live();
    send(toolUse("foreground", "Bash", { command: "pwd" }));
    send(taskStart("foreground-task", "foreground", "Print directory", false));
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_updated",
        task_id: "foreground-task",
        patch: { status: "completed" },
      }),
    );
    expect(parts("foreground").at(-1)?.status).toBe("pending");
    send(toolResult("foreground", "/repo"));
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "ambient",
        tool_use_id: "foreground",
        description: "Watch",
        ambient: true,
      }),
    );
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "orphan",
        description: "Unknown",
      }),
    );
    send(
      snapshot([
        { task_id: "ambient", task_type: "local_bash", description: "Watch", ambient: true },
      ]),
    );
    expect(parts("foreground").at(-1)).toMatchObject({ status: "completed", output: "/repo" });
    expect(session.backgroundToolActiveTaskIds?.size).toBe(0);
    expect(
      events.some((event) => event.type === "assistant_part" && event.part.kind === "subagent"),
    ).toBe(false);
  });

  test("uses a snapshot and native result ID when the start edge is missing", () => {
    const { parts, send, session } = live();
    send(toolUse("bash-no-start", "Bash", { command: "sleep 2" }));
    send(
      snapshot([
        { task_id: "task-no-start", task_type: "local_bash", description: "Wait for server" },
      ]),
    );
    send(toolResult("bash-no-start", "Launched", "task-no-start"));
    expect(parts("bash-no-start").at(-1)).toMatchObject({
      status: "running",
      metadata: { backgroundTaskId: "task-no-start" },
    });
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_progress",
        task_id: "task-no-start",
        tool_use_id: "bash-no-start",
        description: "Wait for server",
        summary: "Server is starting",
      }),
    );
    expect(parts("bash-no-start").at(-1)).toMatchObject({
      output: "Wait for server\nServer is starting",
    });
    expect(hasActiveClaudeBackgroundWork(session)).toBe(true);
  });

  test("keeps Agent tasks out of the ordinary tool activity set", () => {
    const { send, session } = live();
    send(
      snapshot([{ task_id: "agent-task", task_type: "local_agent", description: "Review code" }]),
    );
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "agent-task",
        task_type: "local_agent",
        description: "Review code",
        subagent_type: "Explore",
      }),
    );
    expect(session.backgroundToolActiveTaskIds?.size).toBe(0);
    expect(session.backgroundToolTasksById?.has("agent-task")).toBeFalsy();
  });

  test("terminal outcome wins when the launch result and progress arrive late", () => {
    const { parts, send } = live();
    send(toolUse("bash-late", "Bash", { command: "sleep 1" }));
    send(notification("late-task", "stopped", "Worker restarted"));
    send(taskStart("late-task", "bash-late", "Long command"), "2026-09-24T20:00:01.000Z");
    send(toolResult("bash-late", "Command started", "late-task"), "2026-09-24T20:00:02.000Z");
    send(
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_progress",
        task_id: "late-task",
        description: "Long command",
        summary: "Old progress",
      }),
      "2026-09-24T20:00:03.000Z",
    );
    expect(parts("bash-late").at(-1)).toMatchObject({
      status: "error",
      metadata: { backgroundTaskStatus: "stopped" },
      endedAtMs: Date.parse(timestamp),
    });
    expect(parts("bash-late").at(-1)?.startedAtMs).toBeUndefined();
  });

  test("does not turn a failed background launch into a running card", () => {
    const { parts, send } = live();
    send(toolUse("bash-failed-launch", "Bash", { command: "exit 1" }));
    send(taskStart("failed-launch-task", "bash-failed-launch", "Start command"));
    send(
      claudeSdkMessageFixture({
        type: "user",
        parent_tool_use_id: "bash-failed-launch",
        tool_use_result: {
          type: "tool_result",
          tool_use_id: "bash-failed-launch",
          content: "Could not start command",
          backgroundTaskId: "failed-launch-task",
          is_error: true,
        },
        message: { role: "user", content: [] },
      }),
    );
    expect(parts("bash-failed-launch").at(-1)).toMatchObject({
      status: "error",
      error: "Could not start command",
      metadata: { backgroundTaskStatus: "failed" },
    });
  });

  test("history replays the launch, progress, and terminal state on the same card", () => {
    const assistant = claudeSessionMessageFixture({
      type: "assistant",
      uuid: "assistant-history",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "bash-history", name: "Bash", input: { command: "sleep 1" } },
        ],
      },
    });
    const result = claudeSessionMessageFixture({
      type: "user",
      uuid: "result-history",
      session_id: "session-1",
      parent_tool_use_id: "bash-history",
      timestamp,
      tool_use_result: {
        type: "tool_result",
        tool_use_id: "bash-history",
        content: "Started",
        backgroundTaskId: "history-task",
      },
      message: { role: "user", content: [] },
    });
    const entries = [
      assistant,
      {
        type: "system" as const,
        subtype: "task_started" as const,
        uuid: "start-history",
        session_id: "session-1",
        task_id: "history-task",
        tool_use_id: "bash-history",
        task_type: "local_bash",
        description: "Check files",
        timestamp,
      },
      result,
      {
        type: "system" as const,
        subtype: "task_progress" as const,
        uuid: "progress-history",
        session_id: "session-1",
        task_id: "history-task",
        description: "Check files",
        summary: "2 files done",
        usage: { total_tokens: 0, tool_uses: 0, duration_ms: 1000 },
        timestamp,
      },
    ];
    const running = toClaudeHistoryMessages(entries, () => timestamp);
    const runningPart = running
      .flatMap((message) => message.parts)
      .find((part): part is ToolPart => part.kind === "tool" && part.callId === "bash-history");
    expect(runningPart).toMatchObject({ status: "running", output: "Check files\n2 files done" });
    expect(runningPart?.startedAtMs).toBe(Date.parse(timestamp));
    const completed = toClaudeHistoryMessages(
      [
        ...entries,
        {
          type: "system",
          subtype: "task_notification",
          uuid: "notification-history",
          session_id: "session-1",
          task_id: "history-task",
          status: "completed",
          output_file: "",
          summary: "All checks passed",
          timestamp,
        },
      ],
      () => timestamp,
    );
    const finalPart = completed
      .flatMap((message) => message.parts)
      .find((part): part is ToolPart => part.kind === "tool" && part.callId === "bash-history");
    expect(finalPart).toMatchObject({
      status: "completed",
      output: "Check files\nAll checks passed",
    });

    const lostTerminal = filterClaudeHistoryMessages([
      ...entries,
      {
        type: "system",
        subtype: "background_tasks_changed",
        uuid: "snapshot-history",
        session_id: "session-1",
        timestamp,
        tasks: [],
      },
    ]);
    const unknown = toClaudeHistoryMessages(lostTerminal, () => timestamp);
    const unknownPart = unknown
      .flatMap((message) => message.parts)
      .find((part): part is ToolPart => part.kind === "tool" && part.callId === "bash-history");
    expect(unknownPart).toMatchObject({
      status: "error",
      metadata: { backgroundTaskStatus: "unknown" },
    });
  });
});
