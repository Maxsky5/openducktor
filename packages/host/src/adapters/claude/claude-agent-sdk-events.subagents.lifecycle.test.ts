import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

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
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "agent-task-1",
        tool_use_id: "toolu_agent_1",
        description: "Locate package.json",
        prompt: "Find the root package.json",
        uuid: "agent-task-started-1",
        session_id: "session-1",
      }),
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
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "task-tool-1",
        description: "Inspect auth",
        prompt: "Check the login flow",
        subagent_type: "builder",
        uuid: "task-started-1",
        session_id: "session-1",
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_progress",
        task_id: "task-1",
        description: "Still inspecting",
        summary: "Found auth config",
        subagent_type: "builder",
        uuid: "task-progress-1",
        session_id: "session-1",
      }),
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-06-25T20:00:02.000Z",
      modelSelection,
      emit,
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        summary: "Auth inspected",
        output_file: "/tmp/auth-report.md",
        uuid: "task-notification-1",
        session_id: "session-1",
      }),
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
        message: claudeSdkMessageFixture({
          type: "system",
          subtype: "task_updated",
          task_id,
          patch: { status },
          uuid: `${task_id}-event`,
          session_id: "session-1",
        }),
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
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_updated",
        task_id: "task-1",
        description: "Locate callback.mjs absolute path",
        error: "callback.mjs was not found under the Claude config directory",
        patch: { status: "failed" },
        uuid: "task-updated-1",
        session_id: "session-1",
      }),
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
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_updated",
        task_id: "task-1",
        description: "Locate callback.mjs absolute path",
        patch: { status: "failed" },
        uuid: "task-updated-1",
        session_id: "session-1",
      }),
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
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "failed",
        summary: "Locate callback.mjs absolute path failed",
        uuid: "task-notification-1",
        session_id: "session-1",
      }),
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
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "failed",
        message: "Subagent process exited before producing a transcript",
        uuid: "task-notification-2",
        session_id: "session-1",
      }),
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
