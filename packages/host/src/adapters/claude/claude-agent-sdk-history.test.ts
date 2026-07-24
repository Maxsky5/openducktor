import { describe, expect, test } from "bun:test";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { toClaudeMessageFromParts } from "./claude-agent-sdk-messages";
import {
  claudeHistoryMessageFixtures,
  claudeSessionMessageFixture as toSessionMessage,
} from "./claude-agent-sdk-test-messages";

describe("claude-agent-sdk-history", () => {
  test("preserves Claude transcript timestamps when loading history", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "user-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:13.804Z",
          message: {
            role: "user",
            content: "Plan the task",
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.287Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "Done" }],
            stop_reason: "end_turn",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history.map((message) => message.timestamp)).toEqual([
      "2026-06-26T11:03:13.804Z",
      "2026-06-26T11:03:16.287Z",
    ]);
    expect(history[1]?.parts).toContainEqual({
      kind: "step",
      messageId: "assistant-1",
      partId: "assistant-1:finish",
      phase: "finish",
      reason: "stop",
    });
    expect(history[1]).toMatchObject({
      role: "assistant",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
      },
    });
  });

  test("marks the current Claude success result shape final", () => {
    const history = toClaudeHistoryMessages(
      [
        {
          type: "result",
          subtype: "success",
          uuid: "result-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:03:16.287Z",
          is_error: false,
          result: "Done",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history[0]?.parts).toContainEqual({
      kind: "step",
      messageId: "result-1",
      partId: "result-1:finish",
      phase: "finish",
      reason: "stop",
    });
  });

  test("does not hydrate current context usage from Claude result totals", () => {
    const history = toClaudeHistoryMessages(
      [
        {
          type: "result",
          subtype: "success",
          uuid: "result-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:03:16.287Z",
          is_error: false,
          result: "Done",
          terminal_reason: "completed",
          usage: {
            input_tokens: 11,
            output_tokens: 13,
            cache_creation_input_tokens: 17,
            cache_read_input_tokens: 19,
          },
          modelUsage: {
            "claude-sonnet-4-6": {
              contextWindow: 200_000,
              maxOutputTokens: 64_000,
            },
          },
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history[0]).toEqual(
      expect.not.objectContaining({
        totalTokens: 60,
        contextWindow: 200_000,
      }),
    );
  });

  test("falls back to receive time when Claude history omits a timestamp", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "user-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: "Plan the task",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history[0]?.timestamp).toBe("2026-06-26T12:00:00.000Z");
  });

  test("does not render Claude's interrupted tool-use control record as a user message", () => {
    const history = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([
        {
          type: "user",
          uuid: "interrupted-tool-use-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-07-22T21:35:05.968Z",
          promptId: "prompt-1",
          interruptedByShutdown: true,
          userType: "external",
          entrypoint: "sdk-ts",
          message: {
            role: "user",
            content: [{ type: "text", text: "[Request interrupted by user for tool use]" }],
          },
        },
      ]),
      () => "2026-07-22T22:00:00.000Z",
    );

    expect(history).toEqual([]);
  });

  test("reuses live accepted user ids when hydrating matching Claude user turns", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "sdk-user-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:13.804Z",
          message: {
            role: "user",
            content: "Start with the task.",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [
        {
          messageId: "live-user-1",
          text: "Start with the task.",
        },
      ],
    );

    expect(history[0]?.messageId).toBe("live-user-1");
  });

  test("hydrates Claude user attachment blocks as display parts", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "user-image-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:13.804Z",
          message: {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "base64-data",
                },
              },
            ],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      messageId: "user-image-1",
      role: "user",
      text: "",
      displayParts: [
        {
          kind: "attachment",
          attachment: {
            id: "user-image-1:attachment:0",
            path: "claude-history://attachment/user-image-1/0",
            name: "Claude image attachment.png",
            kind: "image",
            mime: "image/png",
            localPreviewAvailable: false,
          },
        },
      ],
    });
  });

  test("preserves skill and file-reference display parts across the SDK history round trip", async () => {
    const sdkMessage = await toClaudeMessageFromParts([
      { kind: "text", text: "Explain " },
      {
        kind: "skill_mention",
        skill: {
          id: "effect-ts",
          name: "effect-ts",
          path: "effect-ts",
          title: "effect-ts",
        },
      },
      { kind: "text", text: " and inspect " },
      {
        kind: "file_reference",
        file: {
          id: "apps/api/src/routes/groups.ts",
          path: "apps/api/src/routes/groups.ts",
          name: "groups.ts",
          kind: "code",
        },
      },
    ]);
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          ...sdkMessage,
          uuid: "user-structured-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:03:13.804Z",
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [],
      {
        skills: [
          {
            id: "effect-ts",
            name: "effect-ts",
            path: "effect-ts",
            title: "effect-ts",
          },
        ],
      },
    );

    const userMessage = history[0];
    if (userMessage?.role !== "user") {
      throw new Error("Expected structured Claude history to hydrate as a user message");
    }
    expect(userMessage.displayParts).toEqual([
      { kind: "text", text: "Explain " },
      {
        kind: "skill_mention",
        skill: {
          id: "effect-ts",
          name: "effect-ts",
          path: "effect-ts",
          title: "effect-ts",
        },
        sourceText: {
          value: "/effect-ts",
          start: 8,
          end: 18,
        },
      },
      { kind: "text", text: " and inspect " },
      {
        kind: "file_reference",
        file: {
          id: "apps/api/src/routes/groups.ts",
          path: "apps/api/src/routes/groups.ts",
          name: "groups.ts",
          kind: "code",
        },
        sourceText: {
          value: "@apps/api/src/routes/groups.ts",
          start: 31,
          end: 61,
        },
      },
    ]);
  });

  test("does not reinterpret unrelated slash commands or email addresses as references", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "user-plain-markers",
          session_id: "session-1",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: "Run /help and contact dev@example.com",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [],
      {
        skills: [{ id: "effect-ts", name: "effect-ts", path: "effect-ts" }],
      },
    );

    expect(history[0]).toMatchObject({
      role: "user",
      displayParts: [{ kind: "text", text: "Run /help and contact dev@example.com" }],
    });
  });

  test("hydrates Claude skill commands as source-mapped skill chips", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "user-skill-command",
          session_id: "session-1",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: "/grill-me",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [],
      {
        skills: [
          {
            id: "grill-me",
            name: "grill-me",
            path: "grill-me",
            title: "grill-me",
            description: "Grill a plan",
          },
        ],
      },
    );

    expect(history[0]).toMatchObject({
      role: "user",
      text: "/grill-me",
      displayParts: [
        {
          kind: "skill_mention",
          skill: {
            id: "grill-me",
            name: "grill-me",
            path: "grill-me",
            title: "grill-me",
            description: "Grill a plan",
          },
          sourceText: {
            value: "/grill-me",
            start: 0,
            end: 9,
          },
        },
      ],
    });
  });

  test("hydrates exact Claude skill names containing spaces as one chip", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "user-spaced-skill-command",
          session_id: "session-1",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: "/gitnexus:generate_map (MCP)",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [],
      {
        skills: [
          {
            id: "gitnexus:generate_map (MCP)",
            name: "gitnexus:generate_map (MCP)",
            path: "gitnexus:generate_map (MCP)",
            title: "Generate architecture map",
          },
        ],
      },
    );

    expect(history[0]).toMatchObject({
      role: "user",
      text: "/gitnexus:generate_map (MCP)",
      displayParts: [
        {
          kind: "skill_mention",
          skill: {
            id: "gitnexus:generate_map (MCP)",
            name: "gitnexus:generate_map (MCP)",
            path: "gitnexus:generate_map (MCP)",
            title: "Generate architecture map",
          },
          sourceText: {
            value: "/gitnexus:generate_map (MCP)",
            start: 0,
            end: 28,
          },
        },
      ],
    });
  });
});
