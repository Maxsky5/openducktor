import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("handleClaudeSdkMessage denied tool events", () => {
  test("emits permission_denied events as errored tool parts with input and duration", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    session.toolInputsByCallId.set("tool-1", { command: "rm -rf dist" });
    session.toolStartedAtMsByCallId.set("tool-1", Date.parse("2026-06-25T20:00:00.000Z"));

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
        type: "system",
        subtype: "permission_denied",
        uuid: "permission-1",
        session_id: "session-1",
        tool_use_id: "tool-1",
        tool_name: "Bash",
        message: "Denied by policy",
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          error: "Denied by policy",
          input: { command: "rm -rf dist" },
          messageId: "permission-denied:tool-1",
          metadata: { source: "permission_denied" },
          preview: "rm -rf dist",
          status: "error",
          startedAtMs: Date.parse("2026-06-25T20:00:00.000Z"),
          endedAtMs: Date.parse("2026-06-25T20:00:03.000Z"),
          tool: "Bash",
          toolType: "bash",
        }),
      }),
    ]);
  });

  test("emits result permission denials as errored tool parts with denied input", () => {
    const events: AgentEvent[] = [];
    const session = createSession();

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
        type: "result",
        subtype: "success",
        session_id: "session-1",
        duration_ms: 3000,
        duration_api_ms: 2000,
        is_error: false,
        num_turns: 1,
        permission_denials: [
          {
            tool_name: "Bash",
            tool_use_id: "tool-1",
            tool_input: { command: "touch /tmp/outside" },
          },
        ],
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          callId: "tool-1",
          error: "Permission denied for Bash.",
          input: { command: "touch /tmp/outside" },
          messageId: "permission-denied:tool-1",
          metadata: { source: "result_permission_denial" },
          preview: "touch /tmp/outside",
          status: "error",
          endedAtMs: Date.parse("2026-06-25T20:00:03.000Z"),
          tool: "Bash",
          toolType: "bash",
        }),
      }),
    ]);
    expect(session.activity).toBe("running");
  });
});
