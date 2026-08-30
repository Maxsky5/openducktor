import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

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
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "hidden-task",
        description: "Housekeeping",
        skip_transcript: true,
        uuid: "18fac20d-8611-4244-899e-ca5ab57ff530",
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
        subtype: "task_updated",
        task_id: "hidden-task",
        patch: { status: "completed" },
        uuid: "6a75fb59-5b56-4ed2-8a8a-29f63a2c15f0",
        session_id: "session-1",
      }),
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
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "task_started",
        task_id: "shell-task-1",
        tool_use_id: "toolu_bash_1",
        description: "Harmless live lifecycle verification command",
        task_type: "shell",
        uuid: "0dc37ebc-f8ea-4608-8a38-60f1f3d9b48f",
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
        subtype: "task_updated",
        task_id: "shell-task-1",
        patch: { status: "completed" },
        uuid: "0fa19d98-fa08-499b-86d9-0c3be6065600",
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
        task_id: "shell-task-1",
        status: "completed",
        summary: "Harmless live lifecycle verification command",
        uuid: "06e48b8b-6168-4dda-8f17-97878b179c6f",
        session_id: "session-1",
      }),
    });

    expect(events).toEqual([]);
  });
});
