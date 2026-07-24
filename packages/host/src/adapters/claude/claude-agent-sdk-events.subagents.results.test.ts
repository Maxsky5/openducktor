import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

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
      message: claudeSdkMessageFixture({
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
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "tool-result-1",
        session_id: "session-1",
        parent_tool_use_id: null,
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
        tool_use_result: {
          status: "completed",
          prompt: "Locate package.json",
          agentId: "aef1c17051550cb2b",
          agentType: "Explore",
          content: [{ type: "text", text: "Found package.json" }],
          totalDurationMs: 1200,
          totalTokens: 42,
        },
      }),
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
        parent_tool_use_id: null,
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
        tool_use_result: {
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
        message: claudeSdkMessageFixture(message),
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
      message: claudeSdkMessageFixture({
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
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "tool-result-1",
        session_id: "session-1",
        parent_tool_use_id: null,
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
        tool_use_result: {
          status: "failed",
          prompt: "Locate callback.mjs",
          agentId: "failed-agent-1",
          agentType: "Explore",
          reason: "Tool permission request failed",
          totalDurationMs: 23,
        },
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:10:01.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "tool-result-async",
        session_id: "session-1",
        parent_tool_use_id: null,
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
        tool_use_result: {
          status: "async_launched",
          agentId: "async-agent-1",
          description: "Run background verification",
          prompt: "Verify in the background",
          resolvedModel: "claude-haiku-4-5-20251001",
          outputFile: "/tmp/async-agent-1.out",
          canReadOutputFile: true,
        },
      }),
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
      message: claudeSdkMessageFixture({
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
      }),
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
