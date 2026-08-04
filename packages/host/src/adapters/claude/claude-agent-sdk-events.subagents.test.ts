import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { createClaudePostToolUseHook } from "./claude-agent-sdk-post-tool-use-hook";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
import { emitClaudeAgentToolResultSubagentPart } from "./claude-agent-sdk-subagents";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("handleClaudeSdkMessage subagent events", () => {
  test("routes forwarded subagent assistant text only into the nested transcript", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.subagentTaskIdsByToolUseId.set("task-tool-1", "task-1");

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
        parent_tool_use_id: "task-tool-1",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: "nested subagent text" }],
          stop_reason: "end_turn",
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_message",
        externalSessionId: "session-1::claude-subagent::task-1",
        messageId: "assistant-1",
        message: "nested subagent text",
      }),
    ]);
  });

  test("routes nested background subagent task events into their parent transcript", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.subagentTaskIdsByToolUseId.set("outer-agent-tool", "parent-agent");
    const input = {
      session,
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:00.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "parent-agent-tool-call",
        session_id: "session-1",
        parent_tool_use_id: "outer-agent-tool",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "tool_use",
              id: "inner-agent-tool",
              name: "Agent",
              input: {
                description: "Inspect nested behavior",
                prompt: "Inspect nested behavior",
                subagent_type: "Explore",
              },
            },
          ],
          stop_reason: "tool_use",
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        uuid: "nested-task-started",
        session_id: "session-1",
        task_id: "child-agent",
        tool_use_id: "inner-agent-tool",
        description: "Inspect nested behavior",
        subagent_type: "Explore",
        task_type: "local_agent",
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:02.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_progress",
        uuid: "nested-task-progress",
        session_id: "session-1",
        task_id: "child-agent",
        description: "Inspecting",
        subagent_type: "Explore",
        usage: { total_tokens: 10, tool_uses: 1, duration_ms: 1000 },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:03.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_updated",
        uuid: "nested-task-updated",
        session_id: "session-1",
        task_id: "child-agent",
        patch: { status: "running" },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:04.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_notification",
        uuid: "nested-task-completed",
        session_id: "session-1",
        task_id: "child-agent",
        status: "completed",
        output_file: "/tmp/child-agent.output",
        summary: "Nested inspection complete",
      }),
    });

    const subagentEvents = events.filter(
      (event) => event.type === "assistant_part" && event.part.kind === "subagent",
    );
    expect(subagentEvents).toHaveLength(4);
    for (const event of subagentEvents) {
      expect(event).toMatchObject({
        externalSessionId: "session-1::claude-subagent::parent-agent",
        part: {
          kind: "subagent",
          externalSessionId:
            "session-1::claude-subagent::parent-agent::claude-subagent::child-agent",
        },
      });
    }
  });

  test("waits for task completion before finalizing forwarded subagent text without a stop reason", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.subagentTaskIdsByToolUseId.set("task-tool-1", "task-1");
    const input = {
      session,
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:00.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-final",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        subagent_type: "Explore",
        task_description: "Inspect the repository",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: "nested final response" }],
          stop_reason: null,
        },
      }),
    });
    expect(events).toEqual([]);

    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-tool",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "tool_use",
              id: "inner-tool-1",
              name: "Read",
              input: { file_path: "/repo/package.json" },
            },
          ],
          stop_reason: "tool_use",
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:02.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_notification",
        uuid: "task-completed",
        session_id: "session-1",
        task_id: "task-1",
        tool_use_id: "task-tool-1",
        status: "completed",
        output_file: "/tmp/task-1.output",
        summary: "Task completed",
      }),
    });

    const toolIndex = events.findIndex(
      (event) =>
        event.type === "assistant_part" &&
        event.externalSessionId === "session-1::claude-subagent::task-1" &&
        event.part.kind === "tool" &&
        event.part.callId === "inner-tool-1",
    );
    const finalIndex = events.findIndex(
      (event) =>
        event.type === "assistant_message" &&
        event.externalSessionId === "session-1::claude-subagent::task-1" &&
        event.messageId === "assistant-final",
    );
    expect(toolIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex).toBeGreaterThan(toolIndex);
    expect(events[finalIndex]).toEqual(
      expect.objectContaining({
        message: "nested final response",
      }),
    );
  });

  test("routes forwarded subagent user messages into the nested transcript", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.subagentTaskIdsByToolUseId.set("task-tool-1", "task-1");

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T19:59:59.000Z",
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-subagent-1",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        message: {
          role: "user",
          content: "Inspect the runtime subscription",
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "user_message",
        externalSessionId: "session-1::claude-subagent::task-1",
        messageId: "user-subagent-1",
        message: "Inspect the runtime subscription",
        state: "read",
      }),
    ]);
  });

  test("finalizes pending subagent text when the Agent tool result completes first", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.subagentTaskIdsByToolUseId.set("task-tool-1", "task-1");

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
        uuid: "assistant-final",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        message: {
          id: "response-final",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: "nested final response" }],
          stop_reason: null,
        },
      }),
    });
    emitClaudeAgentToolResultSubagentPart({
      emit: (event) => events.push(event),
      input: { subagent_type: "Explore" },
      isError: false,
      resultRaw: {
        toolUseResult: {
          agentId: "task-1",
          status: "completed",
        },
      },
      resultText: "nested final response",
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      toolUseId: "task-tool-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        externalSessionId: "session-1::claude-subagent::task-1",
        messageId: "response-final",
        message: "nested final response",
      }),
    );
  });

  test("marks a background subagent cancelled when TaskStop succeeds", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const input = {
      session,
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:00.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-agent",
        session_id: "session-1",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "tool_use",
              id: "agent-tool",
              name: "Agent",
              input: {
                description: "Audit API changes",
                prompt: "Audit the API changes",
                run_in_background: true,
                subagent_type: "Explore",
              },
            },
          ],
          stop_reason: "tool_use",
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "agent-result",
        session_id: "session-1",
        tool_use_result: {
          agentId: "agent-1",
          status: "async_launched",
        },
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "agent-tool",
              content: "Background agent launched",
            },
          ],
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:02.000Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "agent-tool",
        description: "Audit API changes",
        uuid: "agent-task-started",
        session_id: "session-1",
      }),
    });
    expect(session.activeBackgroundSubagentTaskIds).toEqual(new Set(["task-1"]));

    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:03.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-stop",
        session_id: "session-1",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "tool_use",
              id: "stop-tool",
              name: "TaskStop",
              input: { task_id: "agent-1" },
            },
          ],
          stop_reason: "tool_use",
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:04.000Z",
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "stop-result",
        session_id: "session-1",
        tool_use_result: {
          message: "Successfully stopped task",
          task_id: "agent-1",
          task_type: "local_agent",
        },
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "stop-tool",
              content: "Successfully stopped task",
            },
          ],
        },
      }),
    });

    const subagentEvents = events.filter(
      (event) => event.type === "assistant_part" && event.part.kind === "subagent",
    );
    expect(subagentEvents.at(-1)).toMatchObject({
      externalSessionId: "session-1",
      timestamp: "2026-06-25T20:00:04.000Z",
      part: {
        kind: "subagent",
        messageId: "assistant-agent",
        partId: "claude-subagent:agent-tool",
        correlationKey: "agent-tool",
        status: "cancelled",
        externalSessionId: "session-1::claude-subagent::agent-1",
      },
    });
    expect(session.activeBackgroundSubagentTaskIds).toEqual(new Set());
  });

  test("routes forwarded subagent tool results with their authoritative execution timing", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession();
    session.subagentTaskIdsByToolUseId.set("task-tool-1", "task-1");
    const input = {
      session,
      modelSelection: (model: string) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude" as const,
      }),
      emit: (event: AgentEvent) => events.push(event),
    };

    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:00.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-tool-1",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "tool_use",
              id: "inner-tool-1",
              name: "Read",
              input: { file_path: "/repo/package.json" },
            },
          ],
          stop_reason: "tool_use",
        },
      }),
    });
    await createClaudePostToolUseHook({
      session,
      now: () => "2026-06-25T20:00:00.750Z",
      emit: (event) => events.push(event),
    })(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        transcript_path: "/home/test/.claude/projects/repo/session-1.jsonl",
        cwd: "/repo",
        agent_id: "task-1",
        tool_name: "Read",
        tool_use_id: "inner-tool-1",
        tool_input: { file_path: "/repo/package.json" },
        tool_response: { file: "/repo/package.json" },
        duration_ms: 250,
      },
      "inner-tool-1",
      { signal: new AbortController().signal },
    );
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "user-tool-1",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "inner-tool-1",
              content: [{ type: "text", text: "package contents" }],
            },
          ],
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        externalSessionId: "session-1::claude-subagent::task-1",
        part: expect.objectContaining({
          kind: "tool",
          callId: "inner-tool-1",
          status: "pending",
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        externalSessionId: "session-1::claude-subagent::task-1",
        part: expect.objectContaining({
          kind: "tool",
          callId: "inner-tool-1",
          status: "completed",
          output: "package contents",
          startedAtMs: Date.parse("2026-06-25T20:00:00.500Z"),
          endedAtMs: Date.parse("2026-06-25T20:00:00.750Z"),
        }),
      }),
    ]);
  });
});
