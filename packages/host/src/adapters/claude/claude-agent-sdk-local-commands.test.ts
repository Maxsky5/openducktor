import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import {
  claudeHistoryMessageFixtures,
  claudeSdkMessageFixture,
} from "./claude-agent-sdk-test-messages";

const timestamp = "2026-06-25T20:00:00.000Z";

describe("Claude local slash commands", () => {
  test("projects persisted commands without Claude control messages", () => {
    const outputTimestamp = "2026-06-25T20:00:00.250Z";
    const nextTurnTimestamp = "2026-06-26T15:39:43.000Z";
    const hydrated = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([
        {
          type: "user",
          uuid: "older-context-command",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-25T19:00:00.000Z",
          message: { role: "user", content: "/context" },
        },
        {
          type: "queue-operation",
          operation: "enqueue",
          timestamp,
          sessionId: "session-1",
          content: "/context",
        },
        {
          type: "queue-operation",
          operation: "dequeue",
          timestamp,
          sessionId: "session-1",
        },
        {
          type: "assistant",
          uuid: "synthetic-placeholder",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp,
          message: {
            role: "assistant",
            model: "<synthetic>",
            stop_reason: "stop_sequence",
            content: [{ type: "text", text: "No response requested." }],
          },
        },
        {
          type: "user",
          uuid: "local-command-caveat",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: outputTimestamp,
          isMeta: true,
          message: {
            role: "user",
            content:
              "<local-command-caveat>Internal local command guidance.</local-command-caveat>",
          },
        },
        {
          type: "user",
          uuid: "local-command-input",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: outputTimestamp,
          message: {
            role: "user",
            content:
              "<command-name>/context</command-name>\n<command-message>context</command-message>\n<command-args></command-args>",
          },
        },
        {
          type: "system",
          subtype: "local_command",
          uuid: "local-command-output",
          timestamp: outputTimestamp,
          sessionId: "session-1",
          content: "<local-command-stdout>Context usage: 42%</local-command-stdout>",
        },
        {
          type: "user",
          uuid: "next-user-message",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: nextTurnTimestamp,
          message: { role: "user", content: "Continue with the task" },
        },
      ]),
      () => nextTurnTimestamp,
      [
        {
          messageId: "accepted-context-command",
          text: "/context",
          timestamp,
        },
      ],
    );

    expect(hydrated).toEqual([
      {
        messageId: "older-context-command",
        role: "user",
        timestamp: "2026-06-25T19:00:00.000Z",
        text: "/context",
        displayParts: [{ kind: "text", text: "/context" }],
        state: "read",
        parts: [],
      },
      {
        messageId: "accepted-context-command",
        role: "user",
        timestamp,
        text: "/context",
        displayParts: [{ kind: "text", text: "/context" }],
        state: "read",
        parts: [],
      },
      {
        messageId: "local-command-output",
        role: "assistant",
        timestamp: outputTimestamp,
        text: "Context usage: 42%",
        parts: [
          expect.objectContaining({
            kind: "step",
            reason: "stop",
          }),
        ],
      },
      {
        messageId: "next-user-message",
        role: "user",
        timestamp: nextTurnTimestamp,
        text: "Continue with the task",
        displayParts: [{ kind: "text", text: "Continue with the task" }],
        state: "read",
        parts: [],
      },
    ]);
  });

  test("does not render synthetic transport messages or select their model", () => {
    const events: AgentEvent[] = [];
    const session: ClaudeEventSession = createEventTestSession();
    session.model = {
      providerId: "claude",
      modelId: "gpt-5.6-luna",
      runtimeKind: "claude",
    };

    handleClaudeSdkMessage({
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: "local-command-output",
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          model: "<synthetic>",
          stop_reason: "stop_sequence",
          content: [{ type: "text", text: "Context usage: 42%" }],
        },
      }),
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      session,
      timestamp,
    });

    expect(session.model?.modelId).toBe("gpt-5.6-luna");
    expect(events).toEqual([]);
  });

  test("renders explicit SDK local command output as assistant text", () => {
    const events: AgentEvent[] = [];

    handleClaudeSdkMessage({
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "local_command_output",
        uuid: "local-command-output",
        session_id: "session-1",
        content: "Context usage: 42%",
      }),
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      session: createEventTestSession(),
      timestamp,
    });

    expect(events).toEqual([
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        timestamp,
        messageId: "local-command-output",
        message: "Context usage: 42%",
      },
    ]);
  });

  test("reuses local command output identity and settles the matching result", () => {
    const events: AgentEvent[] = [];
    const session: ClaudeEventSession & {
      sdkState?: "idle" | "requires_action" | "running" | undefined;
    } = createEventTestSession("running");
    session.activeSdkUserTurnCount = 1;
    session.pendingUserTurnCount = 1;
    session.sdkState = "running";

    handleClaudeSdkMessage({
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "local_command_output",
        uuid: "local-command-output",
        session_id: "session-1",
        content: "Context usage: 42%",
      }),
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      session,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "local-command-result",
        session_id: "session-1",
        duration_ms: 38,
        is_error: false,
        result: "Context usage: 42%",
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      session,
      timestamp,
    });

    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.sdkState as "idle" | "requires_action" | "running" | undefined).toBe("idle");
    expect(session.activity as "idle" | "running").toBe("idle");
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "session_idle",
      }),
    );
    expect(events.filter((event) => event.type === "assistant_message")).toEqual([
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        timestamp,
        messageId: "local-command-output",
        message: "Context usage: 42%",
      },
      {
        type: "assistant_message",
        externalSessionId: "session-1",
        timestamp,
        messageId: "local-command-output",
        message: "Context usage: 42%",
      },
    ]);
  });
});
