import { describe, expect, test } from "bun:test";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { claudeSessionMessageFixture as toSessionMessage } from "./claude-agent-sdk-test-messages";

describe("Claude Write creation history", () => {
  test("hydrates created Write results as added file diffs", () => {
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
                id: "tool-write-1",
                name: "Write",
                input: {
                  file_path: "src/new-file.ts",
                  content: "export const value = 1;\n",
                },
              },
            ],
          },
        }),
        toSessionMessage({
          type: "user",
          uuid: "tool-result-1",
          session_id: "session-1",
          parent_tool_use_id: "tool-write-1",
          timestamp: "2026-06-26T11:03:20.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-write-1",
                content: "File created successfully at: src/new-file.ts",
              },
            ],
          },
          toolUseResult: {
            type: "create",
            filePath: "src/new-file.ts",
            content: "export const value = 1;\n",
            structuredPatch: [],
            originalFile: null,
            userModified: false,
          },
        }),
      ],
      () => "2026-06-26T12:00:00.000Z",
    );

    expect(history[0]?.parts[0]).toMatchObject({
      kind: "tool",
      callId: "tool-write-1",
      output: "File created successfully at: src/new-file.ts",
      status: "completed",
      fileDiffs: [
        {
          file: "src/new-file.ts",
          type: "added",
          additions: 1,
          deletions: 0,
          diff: expect.stringContaining("+export const value = 1;"),
        },
      ],
    });
  });
});
