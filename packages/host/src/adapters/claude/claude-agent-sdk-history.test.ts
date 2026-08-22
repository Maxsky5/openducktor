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

  test("appends locally queued live prompts missing from SDK history without duplicating matches", () => {
    const queuedModel = {
      providerId: "claude",
      modelId: "claude-opus-4-6",
      runtimeKind: "claude" as const,
      variant: "high",
    };
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
            content: "First prompt",
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
            content: [{ type: "text", text: "Working" }],
            stop_reason: "tool_use",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [
        {
          messageId: "live-user-1",
          parts: [{ kind: "text", text: "First prompt" }],
          state: "read",
          text: "First prompt",
          timestamp: "2026-06-26T11:03:13.804Z",
        },
        {
          messageId: "live-user-2",
          model: queuedModel,
          parts: [{ kind: "text", text: "Queued follow-up" }],
          state: "queued",
          text: "Queued follow-up",
          timestamp: "2026-06-26T11:03:17.000Z",
        },
      ],
    );

    expect(history.map((message) => message.messageId)).toEqual([
      "live-user-1",
      "assistant-1",
      "live-user-2",
    ]);
    expect(history[2]).toEqual({
      messageId: "live-user-2",
      role: "user",
      timestamp: "2026-06-26T11:03:17.000Z",
      text: "Queued follow-up",
      displayParts: [{ kind: "text", text: "Queued follow-up" }],
      state: "queued",
      model: queuedModel,
      parts: [],
    });
  });

  test("marks the current Claude success result shape final", () => {
    // SAFETY: This test controls the fixture and supplies `Parameters<typeof toClaudeHistoryMessages>[0]` used by this case.
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

  test("hydrates failed Claude results as session errors", () => {
    // SAFETY: This test controls the fixture and supplies `Parameters<typeof toClaudeHistoryMessages>[0]` used by this case.
    const history = toClaudeHistoryMessages(
      [
        {
          type: "result",
          subtype: "error_during_execution",
          uuid: "result-error-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:03:16.287Z",
          is_error: true,
          errors: ["Permission denied for Bash."],
          result: "Fallback failure text",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toEqual([
      {
        messageId: "result-error-1",
        role: "system",
        timestamp: "2026-06-26T11:03:16.287Z",
        text: "Permission denied for Bash.",
        notice: {
          tone: "error",
          reason: "session_error",
          title: "Error",
        },
        parts: [],
      },
    ]);
  });

  test("does not hydrate current context usage from Claude result totals", () => {
    // SAFETY: This test creates the DOM fixture that supplies `Parameters<typeof toClaudeHistoryMessages>[0]` before this lookup.
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

  test("matches repeated user text to the live turn with the same timestamp", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "older-user",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:13.804Z",
          message: {
            role: "user",
            content: "Start with the task.",
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "sdk-user-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:13.804Z",
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
          timestamp: "2026-06-26T11:04:13.804Z",
        },
      ],
    );

    expect(history.map((message) => message.messageId)).toEqual(["older-user", "live-user-1"]);
  });

  test("preserves matched live user message metadata during hydration", () => {
    const model = {
      runtimeKind: "claude" as const,
      providerId: "claude",
      modelId: "claude-sonnet-4-6",
      variant: "high",
    };
    const parts = [
      { kind: "text" as const, text: "Inspect this file " },
      {
        kind: "file_reference" as const,
        file: {
          id: "apps/api/src/app.ts",
          path: "apps/api/src/app.ts",
          name: "app.ts",
          kind: "code" as const,
        },
      },
    ];
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "sdk-user-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:13.804Z",
          message: {
            role: "user",
            content: "Inspect this file @apps/api/src/app.ts",
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
      [
        {
          messageId: "live-user-1",
          text: "Inspect this file @apps/api/src/app.ts",
          timestamp: "2026-06-26T11:04:13.804Z",
          model,
          parts,
          state: "queued",
        },
      ],
    );

    expect(history).toEqual([
      {
        messageId: "live-user-1",
        role: "user",
        timestamp: "2026-06-26T11:04:13.804Z",
        text: "Inspect this file @apps/api/src/app.ts",
        displayParts: parts,
        state: "queued",
        model,
        parts: [],
      },
    ]);
  });

  test("matches attachment-only turns by their live UUID instead of empty text", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "older-image",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:02:13.804Z",
          message: {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "older-base64-data",
                },
              },
            ],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "live-image",
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
      [
        {
          messageId: "live-image",
          text: "",
          timestamp: "2026-06-26T11:03:13.804Z",
        },
      ],
    );

    expect(history).toHaveLength(2);
    expect(history.map((message) => message.messageId)).toEqual(["older-image", "live-image"]);
    expect(history[1]).toMatchObject({
      messageId: "live-image",
      role: "user",
      text: "",
      displayParts: [
        {
          kind: "attachment",
          attachment: {
            id: "live-image:attachment:0",
            path: "claude-history://attachment/live-image/0",
            name: "Claude image attachment.png",
            kind: "image",
            mime: "image/png",
            localPreviewAvailable: false,
          },
        },
      ],
    });
  });

  test("preserves file-reference display parts across the SDK history round trip", async () => {
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
    );

    const userMessage = history[0];
    if (userMessage?.role !== "user") {
      throw new Error("Expected structured Claude history to hydrate as a user message");
    }
    expect(userMessage.displayParts).toEqual([
      { kind: "text", text: "Explain /effect-ts and inspect " },
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

  test("preserves file references with spaces across the SDK history round trip", async () => {
    const sdkMessage = await toClaudeMessageFromParts([
      { kind: "text", text: "Inspect " },
      {
        kind: "file_reference",
        file: {
          id: "docs/My File.md",
          path: "docs/My File.md",
          name: "My File.md",
          kind: "code",
        },
      },
    ]);
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          ...sdkMessage,
          uuid: "user-file-with-spaces",
          session_id: "session-1",
          timestamp: "2026-06-26T11:03:13.804Z",
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const userMessage = history[0];
    if (userMessage?.role !== "user") {
      throw new Error("Expected structured Claude history to hydrate as a user message");
    }
    expect(userMessage.displayParts).toEqual([
      { kind: "text", text: "Inspect " },
      {
        kind: "file_reference",
        file: {
          id: "docs/My File.md",
          path: "docs/My File.md",
          name: "My File.md",
          kind: "code",
        },
        sourceText: {
          value: '@"docs/My File.md"',
          start: 8,
          end: 26,
        },
      },
    ]);
  });

  test("offsets file-reference ranges across attachment-separated text blocks", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "user-reference-after-attachment",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:13.804Z",
          message: {
            role: "user",
            content: [
              { type: "text", text: "Before" },
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: "base64-data",
                },
              },
              { type: "text", text: "@src/after.ts" },
            ],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const userMessage = history[0];
    if (userMessage?.role !== "user") {
      throw new Error("Expected attachment-bearing Claude history to hydrate as a user message");
    }
    expect(userMessage.text).toBe("Before\n@src/after.ts");
    expect(userMessage.displayParts).toEqual([
      { kind: "text", text: "Before" },
      {
        kind: "attachment",
        attachment: {
          id: "user-reference-after-attachment:attachment:1",
          path: "claude-history://attachment/user-reference-after-attachment/1",
          name: "Claude document attachment.pdf",
          kind: "pdf",
          mime: "application/pdf",
          localPreviewAvailable: false,
        },
      },
      {
        kind: "file_reference",
        file: {
          id: "src/after.ts",
          path: "src/after.ts",
          name: "after.ts",
          kind: "code",
        },
        sourceText: {
          value: "@src/after.ts",
          start: 7,
          end: 20,
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
    );

    expect(history[0]).toMatchObject({
      role: "user",
      displayParts: [{ kind: "text", text: "Run /help and contact dev@example.com" }],
    });
  });

  test("keeps skill-looking commands as text until the separate catalog projection", () => {
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
    );

    expect(history[0]).toMatchObject({
      role: "user",
      text: "/grill-me",
      displayParts: [{ kind: "text", text: "/grill-me" }],
    });
  });
});
