import { describe, expect, test } from "bun:test";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { claudeSessionMessageFixture as toSessionMessage } from "./claude-agent-sdk-test-messages";

describe("claude-agent-sdk-history tool projection", () => {
  test("hydrates MCP tool blocks with input and result timestamps", () => {
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
      endedAtMs: Date.parse("2026-06-26T11:03:19.000Z"),
      status: "completed",
    });
    expect(tool).not.toHaveProperty("startedAtMs");
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
      endedAtMs: Date.parse("2026-06-26T11:03:20.000Z"),
      status: "completed",
    });
    expect(tool).not.toHaveProperty("startedAtMs");
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

  test("hydrates Claude NotebookEdit results with the same canonical file diff", () => {
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
                id: "tool-notebook-1",
                name: "NotebookEdit",
                input: {
                  notebook_path: "analysis.ipynb",
                  cell_id: "cell-1",
                  new_source: "print('new')",
                },
              },
            ],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "tool-result-1",
          session_id: "session-1",
          parent_tool_use_id: "tool-notebook-1",
          timestamp: "2026-06-26T11:03:20.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-notebook-1",
                content: "Notebook cell updated",
              },
            ],
          },
          toolUseResult: {
            original_file: '{\n  "cells": [{"source": ["print(\'old\')"]}]\n}\n',
            updated_file: '{\n  "cells": [{"source": ["print(\'new\')"]}]\n}\n',
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history[0]?.parts[0]).toMatchObject({
      kind: "tool",
      callId: "tool-notebook-1",
      tool: "NotebookEdit",
      toolType: "file_edit",
      status: "completed",
      fileDiffs: [
        expect.objectContaining({
          file: "analysis.ipynb",
          additions: 1,
          deletions: 1,
          diff: expect.stringContaining("print('new')"),
        }),
      ],
    });
  });
});
