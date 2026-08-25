import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("handleClaudeSdkMessage Agent tool results", () => {
  test("links Claude Agent tool results to the stored subagent transcript id", () => {
    const events: AgentEvent[] = [];
    const session = {
      ...createSession(),
      subagentEventSessionsByToolUseId: new Map<string, ClaudeEventSession>(),
    };
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
        uuid: "fbce50de-9c81-43c9-8f69-caec240536a1",
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
    session.subagentEventSessionsByToolUseId.set("toolu_agent_1", {
      ...createSession(),
      externalSessionId: "session-1::claude-subagent::aef1c17051550cb2b",
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:03.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "f5e27738-b7ee-4011-8122-53d7ee7c376a",
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
        messageId: "fbce50de-9c81-43c9-8f69-caec240536a1",
        partId: "claude-subagent:toolu_agent_1",
        correlationKey: "toolu_agent_1",
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
    expect(session.subagentEventSessionsByToolUseId.has("toolu_agent_1")).toBe(false);
  });

  test("keeps a forwarded parent Agent result in the root transcript when it follows another result", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.toolNamesByCallId.set("toolu_agent_1", "Agent");

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
        type: "user",
        uuid: "8e84eb6a-6be3-44a2-8ccb-261d3be40772",
        session_id: "session-1",
        parent_tool_use_id: "toolu_agent_1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "inner-tool-1",
              content: [{ type: "text", text: "Nested result" }],
            },
            {
              type: "tool_result",
              tool_use_id: "toolu_agent_1",
              content: [{ type: "text", text: "Agent completed" }],
            },
          ],
        },
      }),
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        externalSessionId: "session-1",
        part: expect.objectContaining({
          kind: "tool",
          callId: "toolu_agent_1",
          status: "completed",
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
        uuid: "fbce50de-9c81-43c9-8f69-caec240536a1",
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
        uuid: "ca115afa-2e40-4467-8fc7-abcf604653dc",
        session_id: "session-1",
        task_id: "agent-1",
        tool_use_id: "toolu_agent_1",
        description: "Runtime progress description",
        subagent_type: "Explore",
      },
      {
        type: "system",
        subtype: "task_progress",
        uuid: "17a2c6a1-b8fe-4674-8cc1-c6bb9ec486ca",
        session_id: "session-1",
        task_id: "agent-1",
        summary: "A progress summary must not replace launch metadata",
      },
      {
        type: "system",
        subtype: "task_notification",
        uuid: "3fb8f462-b090-477f-874f-b5b383be25cb",
        session_id: "session-1",
        task_id: "agent-1",
        status: "completed",
        summary: "The final subagent response must remain transcript content",
      },
      {
        type: "user",
        uuid: "f5e27738-b7ee-4011-8122-53d7ee7c376a",
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
    expect(descriptions).toEqual([
      "Initial agent description",
      undefined,
      undefined,
      "Initial agent description",
    ]);
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
        uuid: "fbce50de-9c81-43c9-8f69-caec240536a1",
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
        uuid: "f5e27738-b7ee-4011-8122-53d7ee7c376a",
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

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:04.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "fa405d3c-4843-45ef-8526-ea467ff322d1",
        session_id: "session-1",
        message: {
          role: "assistant",
          model: "claude-opus-4-8",
          content: [
            {
              type: "tool_use",
              id: "toolu_agent_failed_without_reason",
              name: "Agent",
              input: {
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
      timestamp: "2026-06-25T20:00:05.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "77e1c8bd-3ce9-4fe9-8459-a36d0aa6d7b7",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_agent_failed_without_reason",
            },
          ],
        },
        tool_use_result: {
          status: "failed",
          prompt: "Locate callback.mjs",
          agentId: "failed-agent-2",
          agentType: "Explore",
        },
      }),
    });

    const fallbackSubagentPart = events.find(
      (event): event is Extract<AgentEvent, { type: "assistant_part" }> =>
        event.type === "assistant_part" &&
        event.part.kind === "subagent" &&
        event.part.externalSessionId === "session-1::claude-subagent::failed-agent-2",
    )?.part;

    expect(fallbackSubagentPart).toEqual(
      expect.objectContaining({
        kind: "subagent",
        status: "error",
        error: "Claude subagent failed-agent-2 failed.",
        externalSessionId: "session-1::claude-subagent::failed-agent-2",
      }),
    );
  });

  test("maps Claude async Agent launches as running background subagents", () => {
    const events: AgentEvent[] = [];
    const session = {
      ...createSession(),
      subagentEventSessionsByToolUseId: new Map<string, ClaudeEventSession>(),
    };
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
        uuid: "b32a89aa-0017-4449-8fff-3d7c95faf011",
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
    session.subagentEventSessionsByToolUseId.set("toolu_agent_async", {
      ...createSession(),
      externalSessionId: "session-1::claude-subagent::async-agent-1",
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:10:01.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "9fbcef54-d9be-4ef3-8c97-baf64682e599",
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
        messageId: "b32a89aa-0017-4449-8fff-3d7c95faf011",
        partId: "claude-subagent:toolu_agent_async",
        correlationKey: "toolu_agent_async",
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
    expect(session.subagentEventSessionsByToolUseId.has("toolu_agent_async")).toBe(true);
    expect(session.activeBackgroundSubagentTaskIds).toEqual(new Set(["async-agent-1"]));

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:10:01.500Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "async-task-1",
        tool_use_id: "toolu_agent_async",
        description: "Run background verification",
        uuid: "d68a02d8-3eac-47ab-8166-1db91cb1b59b",
        session_id: "session-1",
      }),
    });

    expect(session.activeBackgroundSubagentTaskIds).toEqual(new Set(["async-task-1"]));

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:10:02.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "f741fcd5-778d-45f4-8aca-8075da15ddca",
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

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:10:03.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_notification",
        task_id: "async-task-1",
        status: "completed",
        summary: "Background verification complete",
        uuid: "5d5cec73-15fd-4a57-8d6b-465811fcc684",
        session_id: "session-1",
      }),
    });

    expect(session.activeBackgroundSubagentTaskIds).toEqual(new Set());
  });

  test("keeps a task-started marker canonical when the async launch result arrives later", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const emit = (event: AgentEvent) => events.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });
    const toolUseId = "toolu_agent_async_start_first";
    session.toolNamesByCallId.set(toolUseId, "Agent");
    session.toolInputsByCallId.set(toolUseId, {
      description: "Run background verification",
      subagent_type: "Explore",
      prompt: "Verify in the background",
      run_in_background: true,
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:20:01.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "async-task-start-first",
        tool_use_id: toolUseId,
        description: "Run background verification",
        uuid: "e54a8887-7e6e-4e63-8c4a-ce99b5725951",
        session_id: "session-1",
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:20:02.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "39e90e78-c2be-4491-8bbe-42af2fa2484b",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: [{ type: "text", text: "Background agent launched" }],
            },
          ],
        },
        tool_use_result: {
          status: "async_launched",
          agentId: "async-agent-start-first",
          description: "Run background verification",
          prompt: "Verify in the background",
        },
      }),
    });

    expect(session.activeBackgroundSubagentTaskIds).toEqual(new Set(["async-task-start-first"]));
  });
});
