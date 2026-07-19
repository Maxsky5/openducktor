import { describe, expect, test } from "bun:test";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { claudeSessionMessageFixture as toSessionMessage } from "./claude-agent-sdk-test-messages";

describe("claude-agent-sdk-history assistant turns", () => {
  test("hydrates Claude thinking and skips superseded text-only tool-use drafts", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-thinking",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:14.000Z",
          message: {
            role: "assistant",
            content: [{ type: "thinking", thinking: "I need the task context first." }],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-draft",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:15.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "I will inspect the task first." }],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-final",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I will inspect the task first." },
              {
                type: "tool_use",
                id: "tool-1",
                name: "mcp__openducktor__odt_read_task",
                input: { taskId: "task-1" },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      messageId: "assistant-thinking",
      role: "assistant",
      text: "",
      parts: [
        {
          kind: "reasoning",
          messageId: "assistant-thinking",
          partId: "assistant-thinking:thinking:0",
          text: "I need the task context first.",
          completed: true,
        },
      ],
    });
    expect(history[1]).toMatchObject({
      messageId: "assistant-final",
      role: "assistant",
      text: "I will inspect the task first.",
    });
    expect(history[1]?.parts[0]).toMatchObject({
      kind: "text",
      messageId: "assistant-final",
      text: "I will inspect the task first.",
      completed: true,
    });
    expect(history[1]?.parts).toContainEqual(
      expect.objectContaining({
        kind: "tool",
        callId: "tool-1",
      }),
    );
    expect(history.flatMap((message) => message.parts)).not.toContainEqual(
      expect.objectContaining({ kind: "step" }),
    );
  });

  test("preserves same-message text before tool-use blocks for hydrated drafts", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-text-tool",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I'll read the task before editing." },
              {
                type: "tool_use",
                id: "tool-1",
                name: "mcp__openducktor__odt_read_task",
                input: { taskId: "task-1" },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.parts.map((part) => part.kind)).toEqual(["text", "tool"]);
  });

  test("hydrates final assistant text carried only by a successful result", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-draft",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:15.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "I will inspect the task first." }],
            stop_reason: "tool_use",
          },
        }),
        {
          type: "result",
          uuid: "result-1",
          timestamp: "2026-06-26T11:03:20.000Z",
          subtype: "success",
          is_error: false,
          result: "FINALSMOKE_VISIBLE",
          stop_reason: "end_turn",
          terminal_reason: "completed",
          usage: { input_tokens: 4, output_tokens: 6 },
        },
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      messageId: "assistant-draft",
      role: "assistant",
      timestamp: "2026-06-26T11:03:15.000Z",
      text: "I will inspect the task first.",
      parts: [],
    });
    expect(history[1]).toMatchObject({
      messageId: "result-1",
      role: "assistant",
      timestamp: "2026-06-26T11:03:20.000Z",
      text: "FINALSMOKE_VISIBLE",
      parts: [
        {
          kind: "step",
          messageId: "result-1",
          partId: "result-1:finish",
          phase: "finish",
          reason: "stop",
        },
      ],
    });
  });

  test("does not duplicate final assistant text repeated by a successful result", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-final",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Spec persisted." }],
            stop_reason: "end_turn",
          },
        }),
        {
          type: "result",
          uuid: "result-1",
          timestamp: "2026-06-26T11:03:20.000Z",
          subtype: "success",
          duration_ms: 4_000,
          is_error: false,
          result: "Spec persisted.",
          stop_reason: "end_turn",
          terminal_reason: "completed",
          usage: { input_tokens: 2, output_tokens: 3 },
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      messageId: "assistant-final",
      text: "Spec persisted.",
      durationMs: 4_000,
    });
    expect(history[0]?.parts.filter((part) => part.kind === "step")).toHaveLength(1);
  });

  test("does not mark reasoning-only end-turn frames as completed turns before final text", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "user-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-07-11T20:00:07.197Z",
          message: { role: "user", content: "Persist the specification" },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-reasoning-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-07-11T20:05:55.612Z",
          message: {
            role: "assistant",
            model: "gpt-5.6-luna",
            content: [{ type: "thinking", thinking: "Checking the result" }],
            stop_reason: "end_turn",
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-final",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-07-11T20:06:00.682Z",
          message: {
            role: "assistant",
            model: "gpt-5.6-luna",
            content: [{ type: "text", text: "Specification persisted." }],
            stop_reason: "end_turn",
          },
        }),
      ],
      () => "2026-07-11T20:06:01.000Z",
    );

    expect(history[1]?.parts.some((part) => part.kind === "step")).toBe(false);
    expect(history[2]?.parts).toContainEqual({
      kind: "step",
      messageId: "assistant-final",
      partId: "assistant-final:finish",
      phase: "finish",
      reason: "stop",
    });
  });

  test("finalizes non-final same-text assistant output repeated by a successful result", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-draft",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Spec persisted." }],
          },
        }),
        {
          type: "result",
          uuid: "result-1",
          timestamp: "2026-06-26T11:03:20.000Z",
          subtype: "success",
          is_error: false,
          result: "Spec persisted.",
          stop_reason: "end_turn",
          terminal_reason: "completed",
          usage: { input_tokens: 2, output_tokens: 3 },
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      messageId: "assistant-draft",
      text: "Spec persisted.",
      parts: [
        {
          kind: "step",
          messageId: "assistant-draft",
          partId: "assistant-draft:finish",
          phase: "finish",
          reason: "stop",
        },
      ],
    });
  });

  test("removes Claude history messages retracted by supersedes and refusal fallback notices", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-refused",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Refused partial." },
              {
                type: "tool_use",
                id: "tool-refused",
                name: "Read",
                input: { file_path: "secret.txt" },
              },
            ],
            stop_reason: "tool_use",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "tool-result-refused",
          session_id: "session-1",
          parent_tool_use_id: "tool-refused",
          timestamp: "2026-06-26T11:03:17.000Z",
          tool_use_result: {
            type: "tool_result",
            tool_use_id: "tool-refused",
            tool_name: "Read",
            content: [{ type: "text", text: "refused tool output" }],
          },
          message: {
            role: "user",
            content: [],
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-canonical",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:18.000Z",
          supersedes: ["assistant-refused", "tool-result-refused"],
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Canonical replacement." }],
            stop_reason: "end_turn",
          },
        }),
        {
          type: "system",
          subtype: "model_refusal_fallback",
          uuid: "fallback-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:03:19.000Z",
          retracted_message_uuids: ["assistant-refused", "tool-result-refused"],
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      messageId: "assistant-canonical",
      role: "assistant",
      text: "Canonical replacement.",
    });
    expect(history[0]?.parts).toContainEqual(
      expect.objectContaining({
        kind: "step",
        reason: "stop",
      }),
    );
  });

  test("hydrates repeated same-text result-only replies across separate user turns", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "user-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            role: "user",
            content: "First request",
          },
        }),
        {
          type: "result",
          subtype: "success",
          uuid: "result-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:11.000Z",
          is_error: false,
          result: "Done.",
          stop_reason: "end_turn",
          terminal_reason: "completed",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        toSessionMessage({
          type: "user",
          uuid: "user-2",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:12.000Z",
          message: {
            role: "user",
            content: "Second request",
          },
        }),
        {
          type: "result",
          subtype: "success",
          uuid: "result-2",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:13.000Z",
          is_error: false,
          result: "Done.",
          stop_reason: "end_turn",
          terminal_reason: "completed",
          usage: { input_tokens: 2, output_tokens: 2 },
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history.map((message) => [message.role, message.text])).toEqual([
      ["user", "First request"],
      ["assistant", "Done."],
      ["user", "Second request"],
      ["assistant", "Done."],
    ]);
    expect(history[1]).toMatchObject({
      messageId: "result-1",
    });
    expect(history[3]).toMatchObject({
      messageId: "result-2",
    });
  });
});
