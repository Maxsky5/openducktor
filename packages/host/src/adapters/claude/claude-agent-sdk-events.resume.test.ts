import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

const modelSelection = (modelId: string) => ({
  providerId: "claude",
  modelId,
  runtimeKind: "claude" as const,
});

describe("handleClaudeSdkMessage after a resume", () => {
  // Claude Code 2.1.318 sends these frames when it resumes a session whose previous process
  // still ran a background shell command.
  test("shows no subagent and no finished turn for a task of the previous process", () => {
    const events: AgentEvent[] = [];
    const session = createSession("idle");
    const send = (message: ReturnType<typeof claudeSdkMessageFixture>) =>
      handleClaudeSdkMessage({
        session,
        timestamp: "2026-11-04T22:13:18.192Z",
        modelSelection,
        emit: (event) => events.push(event),
        message,
      });
    const orphanNotification = claudeSdkMessageFixture({
      type: "system",
      subtype: "task_notification",
      task_id: "bpm0l55fl",
      tool_use_id: "toolu_previous_process",
      status: "stopped",
      output_file: "",
      summary: "Background shell command didn't finish before the previous session ended",
    });
    delete orphanNotification.run_id;

    send(orphanNotification);
    send(
      claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 0,
        result: "",
      }),
    );

    expect(events.filter((event) => event.type === "assistant_part")).toEqual([]);
    expect(events.filter((event) => event.type === "assistant_message")).toEqual([]);
    expect(session.activity).toBe("idle");
  });
});
