import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession as createSession } from "./claude-agent-sdk-events.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("handleClaudeSdkMessage denied tool events", () => {
  test("keeps the original tool identity and detailed reason across denial messages", () => {
    const events: AgentEvent[] = [];
    const session = createSession();
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });
    const emit = (event: AgentEvent) => events.push(event);
    const detailedReason =
      "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [User Deny Rules] The delegated sub-agent is instructed to use Bash, which the user has explicitly denied.";

    handleClaudeSdkMessage({
      emit,
      modelSelection,
      session,
      timestamp: "2026-07-20T20:48:15.000Z",
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "assistant-agent",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "agent-call",
              name: "Agent",
              input: {
                description: "Complete timed TODO sequence",
                prompt: "Use Bash sleep between TaskUpdate calls.",
                subagent_type: "general-purpose",
                run_in_background: false,
              },
            },
          ],
          stop_reason: "tool_use",
        },
      }),
    });
    handleClaudeSdkMessage({
      emit,
      modelSelection,
      session,
      timestamp: "2026-07-20T20:48:15.010Z",
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "permission_denied",
        uuid: "permission-agent",
        session_id: "session-1",
        tool_use_id: "agent-call",
        tool_name: "Task",
        message: detailedReason,
        decision_reason_type: "classifier",
        decision_reason: "[User Deny Rules] Bash is denied.",
      }),
    });
    handleClaudeSdkMessage({
      emit,
      modelSelection,
      session,
      timestamp: "2026-07-20T20:48:15.020Z",
      message: claudeSdkMessageFixture({
        type: "user",
        uuid: "agent-result",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "agent-call",
              is_error: true,
              content: detailedReason,
            },
          ],
        },
      }),
    });
    handleClaudeSdkMessage({
      emit,
      modelSelection,
      session,
      timestamp: "2026-07-20T20:48:15.029Z",
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        session_id: "session-1",
        duration_ms: 29,
        duration_api_ms: 20,
        is_error: false,
        num_turns: 1,
        permission_denials: [
          {
            tool_name: "Task",
            tool_use_id: "agent-call",
            tool_input: { description: "Complete timed TODO sequence" },
          },
        ],
      }),
    });

    const toolParts = events.flatMap((event) =>
      event.type === "assistant_part" &&
      event.part.kind === "tool" &&
      event.part.callId === "agent-call"
        ? [event.part]
        : [],
    );
    expect(toolParts.at(-1)).toEqual(
      expect.objectContaining({
        callId: "agent-call",
        error: detailedReason,
        tool: "Agent",
      }),
    );
    expect(session.toolNamesByCallId.get("agent-call")).toBe("Agent");
  });

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

  test.each(["task", "agent"] as const)(
    "routes subagent permission denials through the %s ID map",
    (idMap) => {
      const events: AgentEvent[] = [];
      const session: ClaudeEventSession = createSession();
      if (idMap === "task") {
        session.subagentTaskIdsByToolUseId.set("agent-call", "agent-1");
      } else {
        session.subagentAgentIdsByToolUseId = new Map([["agent-call", "agent-1"]]);
      }
      const handleMessage = (
        message: Parameters<typeof handleClaudeSdkMessage>[0]["message"],
        timestamp: string,
      ) => {
        handleClaudeSdkMessage({
          session,
          timestamp,
          modelSelection: (model) => ({
            providerId: "claude",
            modelId: model,
            runtimeKind: "claude",
          }),
          emit: (event) => events.push(event),
          message,
        });
      };

      handleMessage(
        claudeSdkMessageFixture({
          type: "assistant",
          uuid: "assistant-subagent",
          session_id: "session-1",
          parent_tool_use_id: "agent-call",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "bash-call",
                name: "Bash",
                input: { command: "rm -rf dist" },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        "2026-06-25T20:00:00.000Z",
      );
      handleMessage(
        claudeSdkMessageFixture({
          type: "system",
          subtype: "permission_denied",
          uuid: "permission-subagent",
          session_id: "session-1",
          tool_use_id: "bash-call",
          tool_name: "Bash",
          message: "Denied by policy",
          agent_id: "agent-1",
        }),
        "2026-06-25T20:00:03.000Z",
      );

      const toolEvents = events.filter(
        (event) =>
          event.type === "assistant_part" &&
          event.part.kind === "tool" &&
          event.part.callId === "bash-call",
      );
      expect(toolEvents).toHaveLength(2);
      expect(toolEvents[0]?.externalSessionId).not.toBe("session-1");
      expect(toolEvents[1]).toEqual(
        expect.objectContaining({
          externalSessionId: toolEvents[0]?.externalSessionId,
          part: expect.objectContaining({
            callId: "bash-call",
            error: "Denied by policy",
            input: { command: "rm -rf dist" },
            status: "error",
          }),
        }),
      );
    },
  );

  test("does not turn result permission summaries into duplicate tool parts", () => {
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

    expect(events.some((event) => event.type === "assistant_part")).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_idle",
      }),
    ]);
    expect(session.activity).toBe("idle");
  });
});
