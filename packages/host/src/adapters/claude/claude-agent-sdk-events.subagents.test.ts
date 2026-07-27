import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { createClaudePostToolUseHook } from "./claude-agent-sdk-post-tool-use-hook";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
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

  test("routes forwarded subagent final text when Claude omits the stop reason", () => {
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

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_message",
        externalSessionId: "session-1::claude-subagent::task-1",
        messageId: "assistant-final",
        message: "nested final response",
      }),
    ]);
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

  test("streams forwarded subagent text deltas into the nested transcript", () => {
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
        type: "stream_event",
        uuid: "stream-1",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        event: {
          type: "message_start",
          message: {},
        },
      }),
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:00.100Z",
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "stream-2",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "live nested text" },
        },
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_delta",
        externalSessionId: "session-1::claude-subagent::task-1",
        delta: "live nested text",
      }),
    ]);
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
