import { describe, expect, test } from "bun:test";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { toClaudeMessageFromParts } from "./claude-agent-sdk-messages";
import { claudeSessionMessageFixture as toSessionMessage } from "./claude-agent-sdk-test-messages";

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

  test("marks completed Claude result history final even when stop_reason is absent", () => {
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
});

describe("claude-agent-sdk-history tool projection", () => {
  test("hydrates MCP tool blocks with input and timing", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "mcp_tool_use",
                id: "tool-1",
                name: "mcp__openducktor__odt_read_task",
                server_name: "openducktor",
                input: { taskId: "task-1" },
              },
            ],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "tool-result-1",
          session_id: "session-1",
          parent_tool_use_id: "tool-1",
          timestamp: "2026-06-26T11:03:19.000Z",
          tool_use_result: {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: [{ type: "text", text: "task details" }],
          },
          message: {
            role: "user",
            content: [],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const tool = history[0]?.parts[0];
    expect(tool).toMatchObject({
      kind: "tool",
      messageId: "assistant-1",
      callId: "tool-1",
      input: { taskId: "task-1" },
      metadata: {
        blockType: "mcp_tool_use",
        serverName: "openducktor",
      },
      output: "task details",
      startedAtMs: Date.parse("2026-06-26T11:03:16.000Z"),
      endedAtMs: Date.parse("2026-06-26T11:03:19.000Z"),
      status: "completed",
    });
  });

  test("hydrates SDK tool_use_id and tool_name fields without generic tool fallbacks", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "server_tool_use",
                tool_use_id: "tool-1",
                tool_name: "Read",
                tool_input: { file_path: "apps/api/src/lib/auth.ts" },
              },
            ],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "tool-result-1",
          session_id: "session-1",
          parent_tool_use_id: "tool-1",
          timestamp: "2026-06-26T11:03:20.000Z",
          tool_use_result: {
            type: "tool_result",
            tool_use_id: "tool-1",
            tool_name: "Read",
            content: [{ type: "text", text: "file contents" }],
          },
          message: {
            role: "user",
            content: [],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const tool = history[0]?.parts[0];
    expect(tool).toMatchObject({
      kind: "tool",
      messageId: "assistant-1",
      callId: "tool-1",
      tool: "Read",
      toolType: "read",
      input: { file_path: "apps/api/src/lib/auth.ts" },
      output: "file contents",
      startedAtMs: Date.parse("2026-06-26T11:03:16.000Z"),
      endedAtMs: Date.parse("2026-06-26T11:03:20.000Z"),
      status: "completed",
    });
  });

  test("hydrates ordinary Claude Read and Bash tool calls with their results", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-read",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "read-1",
                name: "Read",
                input: { file_path: "src/app.ts" },
              },
              {
                type: "tool_use",
                id: "bash-1",
                name: "Bash",
                input: { command: "bun test" },
              },
            ],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "read-result",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:18.000Z",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "read-1", content: "source" },
              { type: "tool_result", tool_use_id: "bash-1", content: "1 pass" },
            ],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.parts).toEqual([
      expect.objectContaining({
        kind: "tool",
        tool: "Read",
        toolType: "read",
        status: "completed",
        output: "source",
      }),
      expect.objectContaining({
        kind: "tool",
        tool: "Bash",
        toolType: "bash",
        status: "completed",
        output: "1 pass",
      }),
    ]);
  });

  test("does not hydrate generic tool rows for nameless orphan tool results", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "user",
          uuid: "orphan-result-1",
          session_id: "session-1",
          parent_tool_use_id: "unknown-tool-1",
          timestamp: "2026-06-26T11:03:20.000Z",
          tool_use_result: {
            type: "tool_result",
            tool_use_id: "unknown-tool-1",
            content: [{ type: "text", text: "unpaired output" }],
          },
          message: {
            role: "user",
            content: [],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toEqual([]);
  });

  test("hydrates Claude Edit result diffs into completed tool parts", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-edit-1",
                name: "Edit",
                input: {
                  file_path: "apps/api/src/lib/auth.ts",
                  old_string: "providers: []",
                  new_string: "providers: [facebook]",
                },
              },
            ],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "tool-result-1",
          session_id: "session-1",
          parent_tool_use_id: "tool-edit-1",
          timestamp: "2026-06-26T11:03:20.000Z",
          tool_use_result: {
            type: "tool_result",
            tool_use_id: "tool-edit-1",
            content: [{ type: "text", text: "edited" }],
            gitDiff: {
              patch:
                "diff --git a/apps/api/src/lib/auth.ts b/apps/api/src/lib/auth.ts\n--- a/apps/api/src/lib/auth.ts\n+++ b/apps/api/src/lib/auth.ts\n@@ -1 +1 @@\n-providers: []\n+providers: [facebook]\n",
            },
          },
          message: {
            role: "user",
            content: [],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history[0]?.parts[0]).toMatchObject({
      kind: "tool",
      callId: "tool-edit-1",
      status: "completed",
      fileDiffs: [
        expect.objectContaining({
          file: "apps/api/src/lib/auth.ts",
          additions: 1,
          deletions: 1,
        }),
      ],
    });
  });

  test("hydrates real Claude Edit top-level toolUseResult patches without dropping output", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-edit-real",
                name: "Edit",
                input: {
                  file_path: "apps/api/src/lib/auth.ts",
                  old_string: "providers: []",
                  new_string: "providers: [facebook]",
                },
              },
            ],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "tool-result-1",
          session_id: "session-1",
          parent_tool_use_id: "tool-edit-real",
          timestamp: "2026-06-26T11:03:20.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-edit-real",
                content: "The file apps/api/src/lib/auth.ts has been updated successfully.",
              },
            ],
          },
          toolUseResult: {
            filePath: "apps/api/src/lib/auth.ts",
            oldString: "providers: []",
            newString: "providers: [facebook]",
            originalFile: "providers: []\n",
            structuredPatch: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: ["-providers: []", "+providers: [facebook]"],
              },
            ],
            userModified: false,
            replaceAll: false,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history[0]?.parts[0]).toMatchObject({
      kind: "tool",
      callId: "tool-edit-real",
      input: {
        file_path: "apps/api/src/lib/auth.ts",
        old_string: "providers: []",
        new_string: "providers: [facebook]",
      },
      output: "The file apps/api/src/lib/auth.ts has been updated successfully.",
      startedAtMs: Date.parse("2026-06-26T11:03:16.000Z"),
      endedAtMs: Date.parse("2026-06-26T11:03:20.000Z"),
      status: "completed",
      fileDiffs: [
        expect.objectContaining({
          file: "apps/api/src/lib/auth.ts",
          additions: 1,
          deletions: 1,
          diff: expect.stringContaining("+providers: [facebook]"),
        }),
      ],
    });
  });

  test("hydrates real Claude Write top-level toolUseResult patches without dropping output", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:03:16.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-write-real",
                name: "Write",
                input: {
                  file_path: "README.md",
                  content: "# Updated\n",
                },
              },
            ],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "tool-result-1",
          session_id: "session-1",
          parent_tool_use_id: "tool-write-real",
          timestamp: "2026-06-26T11:03:20.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-write-real",
                content: "The file README.md has been updated successfully.",
              },
            ],
          },
          toolUseResult: {
            type: "update",
            filePath: "README.md",
            content: "# Updated\n",
            structuredPatch: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: ["-# Old", "+# Updated"],
              },
            ],
            originalFile: "# Old\n",
            userModified: false,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history[0]?.parts[0]).toMatchObject({
      kind: "tool",
      callId: "tool-write-real",
      input: {
        file_path: "README.md",
        content: "# Updated\n",
      },
      output: "The file README.md has been updated successfully.",
      startedAtMs: Date.parse("2026-06-26T11:03:16.000Z"),
      endedAtMs: Date.parse("2026-06-26T11:03:20.000Z"),
      status: "completed",
      fileDiffs: [
        expect.objectContaining({
          file: "README.md",
          additions: 1,
          deletions: 1,
          diff: expect.stringContaining("+# Updated"),
        }),
      ],
    });
  });
});

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

describe("claude-agent-sdk-history subagents", () => {
  test("does not hydrate subagent sidechain messages into the parent transcript", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "subagent-forwarded-parent-tool",
          session_id: "session-1",
          parent_tool_use_id: "task-tool-1",
          timestamp: "2026-06-26T11:04:13.782Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Forwarded subagent assistant text" }],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "subagent-user-parent-tool",
          session_id: "session-1",
          parent_tool_use_id: "task-tool-1",
          timestamp: "2026-06-26T11:04:14.000Z",
          message: {
            role: "user",
            content: "Forwarded subagent user text",
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "subagent-assistant",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:14.782Z",
          isSidechain: true,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Nested worker details" }],
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "subagent-forwarded",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:15.020Z",
          subagent_type: "Explore",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Forwarded worker details" }],
          },
        }),
        toSessionMessage({
          type: "assistant",
          uuid: "parent-assistant",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:16.254Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Parent response" }],
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      messageId: "parent-assistant",
      role: "assistant",
      text: "Parent response",
    });
  });

  test("hydrates Claude task system entries as anchored subagent parts", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          sessionId: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "task-tool-1",
                name: "Task",
                input: { description: "Run affected web tests" },
              },
            ],
          },
        }),
        {
          type: "system",
          subtype: "task_started",
          uuid: "task-started-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:11.000Z",
          task_id: "task-1",
          tool_use_id: "task-tool-1",
          description: "Run affected web tests",
          subagent_type: "general-purpose",
        },
        {
          type: "system",
          subtype: "task_notification",
          uuid: "task-finished-1",
          session_id: "session-1",
          timestamp: "2026-06-26T11:04:12.000Z",
          task_id: "task-1",
          status: "completed",
          summary: "Tests passed",
        },
      ] as Parameters<typeof toClaudeHistoryMessages>[0],
      () => "2026-06-26T12:00:00.000Z",
    );

    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );
    expect(subagentParts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-1",
        correlationKey: "task-1",
        status: "running",
        description: "Run affected web tests",
        startedAtMs: Date.parse("2026-06-26T11:04:11.000Z"),
      }),
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-1",
        correlationKey: "task-1",
        status: "completed",
        endedAtMs: Date.parse("2026-06-26T11:04:12.000Z"),
      }),
    ]);
    expect(subagentParts[1]).not.toHaveProperty("description");
  });

  test("hydrates Claude Agent tool results with the stored subagent transcript id", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            role: "assistant",
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
        toSessionMessage({
          type: "user",
          uuid: "agent-result-1",
          sessionId: "session-1",
          timestamp: "2026-06-26T11:04:13.000Z",
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
          toolUseResult: {
            status: "completed",
            prompt: "Locate package.json",
            agentId: "aef1c17051550cb2b",
            agentType: "Explore",
            content: [{ type: "text", text: "Found package.json" }],
            totalDurationMs: 1200,
            totalTokens: 42,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );
    expect(subagentParts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-1",
        partId: "claude-subagent:aef1c17051550cb2b",
        correlationKey: "session:toolu_agent_1:session-1::claude-subagent::aef1c17051550cb2b",
        status: "completed",
        agent: "Explore",
        prompt: "Locate package.json",
        description: "Locate package.json path",
        externalSessionId: "session-1::claude-subagent::aef1c17051550cb2b",
        startedAtMs: Date.parse("2026-06-26T11:04:11.800Z"),
        endedAtMs: Date.parse("2026-06-26T11:04:13.000Z"),
        metadata: expect.objectContaining({
          agentId: "aef1c17051550cb2b",
          sourceToolUseId: "toolu_agent_1",
          totalDurationMs: 1200,
          totalTokens: 42,
        }),
      }),
    ]);
  });

  test("hydrates failed Claude Agent tool results with visible error reasons", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-1",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:04:10.000Z",
          message: {
            role: "assistant",
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
        toSessionMessage({
          type: "user",
          uuid: "agent-result-failed",
          sessionId: "session-1",
          timestamp: "2026-06-26T11:04:13.000Z",
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
          toolUseResult: {
            status: "failed",
            prompt: "Locate callback.mjs",
            agentId: "failed-agent-1",
            agentType: "Explore",
            reason: "Tool permission request failed",
            totalDurationMs: 23,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );
    expect(subagentParts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        status: "error",
        error: "Tool permission request failed",
        description: "Locate callback.mjs absolute path",
        externalSessionId: "session-1::claude-subagent::failed-agent-1",
      }),
    ]);
  });

  test("hydrates Claude async Agent launches as running background subagents", () => {
    const history = toClaudeHistoryMessages(
      [
        toSessionMessage({
          type: "assistant",
          uuid: "assistant-async",
          session_id: "session-1",
          parent_tool_use_id: null,
          timestamp: "2026-06-26T11:14:10.000Z",
          message: {
            role: "assistant",
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
        toSessionMessage({
          type: "user",
          uuid: "agent-result-async",
          sessionId: "session-1",
          timestamp: "2026-06-26T11:14:11.000Z",
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
          toolUseResult: {
            status: "async_launched",
            agentId: "async-agent-1",
            description: "Run background verification",
            prompt: "Verify in the background",
            resolvedModel: "claude-haiku-4-5-20251001",
            outputFile: "/tmp/async-agent-1.out",
            canReadOutputFile: true,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    const subagentParts = history.flatMap((message) =>
      message.parts.filter((part) => part.kind === "subagent"),
    );
    expect(subagentParts).toEqual([
      expect.objectContaining({
        kind: "subagent",
        messageId: "assistant-async",
        partId: "claude-subagent:async-agent-1",
        correlationKey: "session:toolu_agent_async:session-1::claude-subagent::async-agent-1",
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
    ]);
    expect(subagentParts[0]).not.toHaveProperty("endedAtMs");
  });
});
