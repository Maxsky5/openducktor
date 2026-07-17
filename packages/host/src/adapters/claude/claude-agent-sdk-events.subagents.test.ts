import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";

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
      message: {
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
      } as unknown as SDKMessage,
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
      message: {
        type: "user",
        uuid: "user-subagent-1",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        message: {
          role: "user",
          content: "Inspect the runtime subscription",
        },
      } as unknown as SDKMessage,
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
      message: {
        type: "stream_event",
        uuid: "stream-1",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        event: {
          type: "message_start",
          message: {},
        },
      } as unknown as SDKMessage,
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:00.100Z",
      message: {
        type: "stream_event",
        uuid: "stream-2",
        session_id: "session-1",
        parent_tool_use_id: "task-tool-1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "live nested text" },
        },
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_delta",
        externalSessionId: "session-1::claude-subagent::task-1",
        delta: "live nested text",
      }),
    ]);
  });

  test("routes forwarded subagent tool results by their inner tool id", () => {
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
      message: {
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
      } as unknown as SDKMessage,
    });
    handleClaudeSdkMessage({
      ...input,
      timestamp: "2026-06-25T20:00:01.000Z",
      message: {
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
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        externalSessionId: "session-1::claude-subagent::task-1",
        part: expect.objectContaining({
          kind: "tool",
          callId: "inner-tool-1",
          status: "running",
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
        }),
      }),
    ]);
  });
});

describe("handleClaudeSdkMessage subagent visibility", () => {
  test("hides Claude subagent tasks flagged with skip_transcript", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_started",
        task_id: "hidden-task",
        description: "Housekeeping",
        skip_transcript: true,
        uuid: "task-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });
    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_updated",
        task_id: "hidden-task",
        patch: { status: "completed" },
        uuid: "task-2",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([]);
  });

  test("hides Claude task events that belong to non-Agent tools", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.toolNamesByCallId.set("toolu_bash_1", "Bash");
    session.toolMessageIdsByCallId.set("toolu_bash_1", "assistant-1");
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_started",
        task_id: "shell-task-1",
        tool_use_id: "toolu_bash_1",
        description: "Harmless live lifecycle verification command",
        task_type: "shell",
        uuid: "shell-task-started-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_updated",
        task_id: "shell-task-1",
        patch: { status: "completed" },
        uuid: "shell-task-updated-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:02.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_notification",
        task_id: "shell-task-1",
        status: "completed",
        summary: "Harmless live lifecycle verification command",
        uuid: "shell-task-notification-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([]);
  });
});

describe("handleClaudeSdkMessage subagent task lifecycle", () => {
  test("maps Claude task events for Agent tool calls without subagent_type", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.toolNamesByCallId.set("toolu_agent_1", "Agent");
    session.toolMessageIdsByCallId.set("toolu_agent_1", "assistant-1");
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_started",
        task_id: "agent-task-1",
        tool_use_id: "toolu_agent_1",
        description: "Locate package.json",
        prompt: "Find the root package.json",
        uuid: "agent-task-started-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "subagent",
          messageId: "assistant-1",
          correlationKey: "agent-task-1",
          status: "running",
          externalSessionId: "session-1::claude-subagent::agent-task-1",
          description: "Locate package.json",
          prompt: "Find the root package.json",
        }),
      }),
    ]);
  });

  test("maps Claude subagent task metadata across start, progress, and notification events", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.toolMessageIdsByCallId.set("task-tool-1", "assistant-1");
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "task-tool-1",
        description: "Inspect auth",
        prompt: "Check the login flow",
        subagent_type: "builder",
        uuid: "task-started-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_progress",
        task_id: "task-1",
        description: "Still inspecting",
        summary: "Found auth config",
        subagent_type: "builder",
        uuid: "task-progress-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:02.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        summary: "Auth inspected",
        output_file: "/tmp/auth-report.md",
        uuid: "task-notification-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "subagent",
          messageId: "assistant-1",
          correlationKey: "task-1",
          status: "running",
          agent: "builder",
          externalSessionId: "session-1::claude-subagent::task-1",
          description: "Inspect auth",
          prompt: "Check the login flow",
          executionMode: "foreground",
          startedAtMs: Date.parse("2026-06-25T20:00:00.000Z"),
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "subagent",
          correlationKey: "task-1",
          status: "running",
          agent: "builder",
          externalSessionId: "session-1::claude-subagent::task-1",
        }),
      }),
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "subagent",
          correlationKey: "task-1",
          status: "completed",
          externalSessionId: "session-1::claude-subagent::task-1",
          endedAtMs: Date.parse("2026-06-25T20:00:02.000Z"),
          metadata: {
            outputFile: "/tmp/auth-report.md",
          },
        }),
      }),
    ]);
  });

  test("maps Claude task status updates explicitly", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    for (const [task_id, status] of [
      ["done-task", "completed"],
      ["failed-task", "failed"],
      ["killed-task", "killed"],
      ["paused-task", "paused"],
    ] as const) {
      handleClaudeSdkMessage({
        session,
        timestamp: "2026-06-25T20:00:00.000Z",
        modelSelection,
        emit,
        message: {
          type: "system",
          subtype: "task_updated",
          task_id,
          patch: { status },
          uuid: `${task_id}-event`,
          session_id: "session-1",
        } as unknown as SDKMessage,
      });
    }

    expect(
      events.map((event) =>
        event.type === "assistant_part" && event.part.kind === "subagent"
          ? [event.part.correlationKey, event.part.status]
          : null,
      ),
    ).toEqual([
      ["done-task", "completed"],
      ["failed-task", "error"],
      ["killed-task", "cancelled"],
      ["paused-task", "running"],
    ]);
  });

  test("maps failed Claude task updates with top-level error reasons", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.subagentMessageIdsByTaskId.set("task-1", "assistant-1");
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:02.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_updated",
        task_id: "task-1",
        description: "Locate callback.mjs absolute path",
        error: "callback.mjs was not found under the Claude config directory",
        patch: { status: "failed" },
        uuid: "task-updated-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "subagent",
          messageId: "assistant-1",
          correlationKey: "task-1",
          status: "error",
          externalSessionId: "session-1::claude-subagent::task-1",
          error: "callback.mjs was not found under the Claude config directory",
        }),
      }),
    ]);
  });

  test("maps failed Claude task updates without an error to a visible fallback reason", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.subagentMessageIdsByTaskId.set("task-1", "assistant-1");
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:02.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_updated",
        task_id: "task-1",
        description: "Locate callback.mjs absolute path",
        patch: { status: "failed" },
        uuid: "task-updated-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "subagent",
          messageId: "assistant-1",
          correlationKey: "task-1",
          status: "error",
          externalSessionId: "session-1::claude-subagent::task-1",
          error: "Claude subagent task-1 failed.",
        }),
      }),
    ]);
  });

  test("maps failed Claude task notifications with visible error reasons", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.subagentMessageIdsByTaskId.set("task-1", "assistant-1");
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "failed",
        summary: "Locate callback.mjs absolute path failed",
        uuid: "task-notification-1",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "subagent",
          messageId: "assistant-1",
          correlationKey: "task-1",
          status: "error",
          externalSessionId: "session-1::claude-subagent::task-1",
          error: "Locate callback.mjs absolute path failed",
          endedAtMs: Date.parse("2026-06-25T20:00:03.000Z"),
        }),
      }),
    ]);
  });

  test("maps failed Claude task notifications without a summary to a visible error", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.subagentMessageIdsByTaskId.set("task-1", "assistant-1");
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:04.000Z",
      modelSelection,
      emit,
      message: {
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "failed",
        message: "Subagent process exited before producing a transcript",
        uuid: "task-notification-2",
        session_id: "session-1",
      } as unknown as SDKMessage,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "subagent",
          messageId: "assistant-1",
          correlationKey: "task-1",
          status: "error",
          externalSessionId: "session-1::claude-subagent::task-1",
          error: "Subagent process exited before producing a transcript",
        }),
      }),
    ]);
  });
});

describe("handleClaudeSdkMessage Agent tool results", () => {
  test("links Claude Agent tool results to the stored subagent transcript id", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection,
      emit,
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          model: "claude-opus-4-8",
          content: [
            {
              type: "tool_use",
              id: "toolu_agent_1",
              name: "Agent",
              input: {
                description: "Locate package.json path",
                subagent_type: "Explore",
                prompt: "Locate package.json",
              },
            },
          ],
          stop_reason: "tool_use",
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection,
      emit,
      message: {
        type: "user",
        uuid: "tool-result-1",
        session_id: "session-1",
        parent_tool_use_id: "toolu_agent_1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_agent_1",
              content: [{ type: "text", text: "Found package.json" }],
            },
          ],
        },
        toolUseResult: {
          status: "completed",
          prompt: "Locate package.json",
          agentId: "aef1c17051550cb2b",
          agentType: "Explore",
          content: [{ type: "text", text: "Found package.json" }],
          totalDurationMs: 1200,
          totalTokens: 42,
        },
      } as unknown as SDKMessage,
    });

    const subagentPart = events.find(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part" &&
        event.part.kind === "subagent" &&
        event.part.externalSessionId === "session-1::claude-subagent::aef1c17051550cb2b",
    )?.part;

    expect(subagentPart).toEqual(
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-1",
        partId: "claude-subagent:aef1c17051550cb2b",
        correlationKey: "session:toolu_agent_1:session-1::claude-subagent::aef1c17051550cb2b",
        status: "completed",
        agent: "Explore",
        prompt: "Locate package.json",
        description: "Locate package.json path",
        externalSessionId: "session-1::claude-subagent::aef1c17051550cb2b",
        startedAtMs: Date.parse("2026-06-25T20:00:01.800Z"),
        endedAtMs: Date.parse("2026-06-25T20:00:03.000Z"),
        metadata: expect.objectContaining({
          agentId: "aef1c17051550cb2b",
          sourceToolUseId: "toolu_agent_1",
          totalDurationMs: 1200,
          totalTokens: 42,
        }),
      }),
    );
  });

  test("keeps the task-started description immutable across progress and completion", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    for (const message of [
      {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          model: "claude-opus-4-8",
          content: [
            {
              type: "tool_use",
              id: "toolu_agent_1",
              name: "Agent",
              input: {
                description: "Initial agent description",
                subagent_type: "Explore",
                prompt: "Inspect authentication",
              },
            },
          ],
          stop_reason: "tool_use",
        },
      },
      {
        type: "system",
        subtype: "task_started",
        uuid: "task-started-1",
        session_id: "session-1",
        task_id: "agent-1",
        tool_use_id: "toolu_agent_1",
        description: "Initial agent description",
        subagent_type: "Explore",
      },
      {
        type: "system",
        subtype: "task_progress",
        uuid: "task-progress-1",
        session_id: "session-1",
        task_id: "agent-1",
        summary: "A progress summary must not replace launch metadata",
      },
      {
        type: "system",
        subtype: "task_notification",
        uuid: "task-finished-1",
        session_id: "session-1",
        task_id: "agent-1",
        status: "completed",
        summary: "The final subagent response must remain transcript content",
      },
      {
        type: "user",
        uuid: "tool-result-1",
        session_id: "session-1",
        parent_tool_use_id: "toolu_agent_1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_agent_1",
              content: [
                {
                  type: "text",
                  text: "The final subagent response must remain transcript content",
                },
              ],
            },
          ],
        },
        toolUseResult: {
          status: "completed",
          agentId: "agent-1",
          agentType: "Explore",
          content: [
            { type: "text", text: "The final subagent response must remain transcript content" },
          ],
        },
      },
    ] as const) {
      handleClaudeSdkMessage({
        session,
        timestamp: "2026-06-25T20:00:00.000Z",
        modelSelection,
        emit,
        message: message as unknown as SDKMessage,
      });
    }

    const descriptions = events.flatMap((event) =>
      event.type === "assistant_part" && event.part.kind === "subagent"
        ? [event.part.description]
        : [],
    );
    expect(descriptions).toEqual(["Initial agent description", undefined, undefined, undefined]);
  });

  test("maps failed Claude Agent tool results with visible error reasons", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:00.000Z",
      modelSelection,
      emit,
      message: {
        type: "assistant",
        uuid: "assistant-1",
        session_id: "session-1",
        message: {
          role: "assistant",
          model: "claude-opus-4-8",
          content: [
            {
              type: "tool_use",
              id: "toolu_agent_failed",
              name: "Agent",
              input: {
                description: "Locate callback.mjs absolute path",
                subagent_type: "Explore",
                prompt: "Locate callback.mjs",
              },
            },
          ],
          stop_reason: "tool_use",
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection,
      emit,
      message: {
        type: "user",
        uuid: "tool-result-1",
        session_id: "session-1",
        parent_tool_use_id: "toolu_agent_failed",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_agent_failed",
              content: [{ type: "text", text: "Agent failed" }],
            },
          ],
        },
        toolUseResult: {
          status: "failed",
          prompt: "Locate callback.mjs",
          agentId: "failed-agent-1",
          agentType: "Explore",
          reason: "Tool permission request failed",
          totalDurationMs: 23,
        },
      } as unknown as SDKMessage,
    });

    const subagentPart = events.find(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part" &&
        event.part.kind === "subagent" &&
        event.part.externalSessionId === "session-1::claude-subagent::failed-agent-1",
    )?.part;

    expect(subagentPart).toEqual(
      expect.objectContaining({
        kind: "subagent",
        status: "error",
        error: "Tool permission request failed",
        description: "Locate callback.mjs absolute path",
        externalSessionId: "session-1::claude-subagent::failed-agent-1",
      }),
    );
  });

  test("maps Claude async Agent launches as running background subagents", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:10:00.000Z",
      modelSelection,
      emit,
      message: {
        type: "assistant",
        uuid: "assistant-async",
        session_id: "session-1",
        message: {
          role: "assistant",
          model: "claude-opus-4-8",
          content: [
            {
              type: "tool_use",
              id: "toolu_agent_async",
              name: "Agent",
              input: {
                description: "Run background verification",
                subagent_type: "Explore",
                prompt: "Verify in the background",
                run_in_background: true,
              },
            },
          ],
          stop_reason: "tool_use",
        },
      } as unknown as SDKMessage,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:10:01.000Z",
      modelSelection,
      emit,
      message: {
        type: "user",
        uuid: "tool-result-async",
        session_id: "session-1",
        parent_tool_use_id: "toolu_agent_async",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_agent_async",
              content: [{ type: "text", text: "Background agent launched" }],
            },
          ],
        },
        toolUseResult: {
          status: "async_launched",
          agentId: "async-agent-1",
          description: "Run background verification",
          prompt: "Verify in the background",
          resolvedModel: "claude-haiku-4-5-20251001",
          outputFile: "/tmp/async-agent-1.out",
          canReadOutputFile: true,
        },
      } as unknown as SDKMessage,
    });

    const subagentPart = events.find(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part" &&
        event.part.kind === "subagent" &&
        event.part.externalSessionId === "session-1::claude-subagent::async-agent-1",
    )?.part;

    expect(subagentPart).toEqual(
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-async",
        partId: "claude-subagent:async-agent-1",
        correlationKey: "session:toolu_agent_async:session-1::claude-subagent::async-agent-1",
        status: "running",
        executionMode: "background",
        agent: "Explore",
        prompt: "Verify in the background",
        description: "Run background verification",
        externalSessionId: "session-1::claude-subagent::async-agent-1",
        metadata: expect.objectContaining({
          agentId: "async-agent-1",
          sourceToolUseId: "toolu_agent_async",
          resolvedModel: "claude-haiku-4-5-20251001",
          outputFile: "/tmp/async-agent-1.out",
          canReadOutputFile: true,
        }),
      }),
    );
    expect(subagentPart).not.toHaveProperty("endedAtMs");

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:10:02.000Z",
      modelSelection,
      emit,
      message: {
        type: "assistant",
        uuid: "assistant-async-progress",
        session_id: "session-1",
        parent_tool_use_id: "toolu_agent_async",
        message: {
          role: "assistant",
          model: "claude-haiku-4-5-20251001",
          content: [{ type: "text", text: "Background verification progress" }],
          stop_reason: "end_turn",
        },
      } as unknown as SDKMessage,
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_message",
        externalSessionId: "session-1::claude-subagent::async-agent-1",
        message: "Background verification progress",
      }),
    );
  });
});
