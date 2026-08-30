import { describe, expect, test } from "bun:test";
import { filterClaudeHistoryMessages } from "./claude-agent-sdk-history-import";
import { parseClaudeUserToolResultIngress } from "./claude-agent-sdk-ingress-schemas";
import { createClaudePostToolUseHook } from "./claude-agent-sdk-post-tool-use-hook";
import { createClaudePreToolUseHook } from "./claude-agent-sdk-pre-tool-use-hook";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";

describe("Claude SDK ingress", () => {
  test("rejects malformed history entries before history projection", () => {
    const malformedHistory = [{ type: "assistant", message: new Date() }];
    let error: unknown;
    try {
      filterClaudeHistoryMessages(malformedHistory);
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({
      _tag: "HostValidationError",
      field: "claudeHistoryAssistantMessage",
    });
  });

  test("rejects malformed pre-tool input before authorization", async () => {
    const hook = createClaudePreToolUseHook({ session: createClaudeSession() });
    const malformedInput: Parameters<typeof hook>[0] = {
      cwd: "/repo",
      hook_event_name: "PreToolUse",
      session_id: "session-1",
      tool_name: "Bash",
      tool_input: "pwd",
      tool_use_id: "tool-1",
      transcript_path: "/repo/transcript.jsonl",
    };

    await expect(
      hook(malformedInput, "tool-1", { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "claudePreToolUse",
    });
  });

  test("rejects malformed post-tool input before transcript projection", async () => {
    const hook = createClaudePostToolUseHook({
      emit: () => {},
      now: () => "2026-08-21T12:00:00.000Z",
      session: createClaudeSession(),
    });
    const malformedInput: Parameters<typeof hook>[0] = {
      cwd: "/repo",
      hook_event_name: "PostToolUse",
      session_id: "session-1",
      tool_name: "Edit",
      tool_input: { file_path: "src/file.ts" },
      tool_response: new Date(),
      tool_use_id: "tool-1",
      transcript_path: "/repo/transcript.jsonl",
    };

    await expect(
      hook(malformedInput, "tool-1", { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "claudeFileEditToolResponse",
    });
  });

  test("ignores scalar structured output and keeps the nested tool result", () => {
    const result = parseClaudeUserToolResultIngress({
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-search",
            content: "Repository not found",
            is_error: true,
          },
        ],
      },
      tool_use_result: "Error: Repository not found",
    });

    expect(result.toolResults).toEqual([
      {
        raw: {
          type: "tool_result",
          tool_use_id: "tool-search",
          content: "Repository not found",
          is_error: true,
        },
      },
    ]);
  });

  test("correlates structured tool output with the nested result ID", () => {
    const result = parseClaudeUserToolResultIngress({
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-create",
            content: "Task #1 created successfully",
          },
        ],
      },
      tool_use_result: {
        task: { id: "1", subject: "Add tests" },
      },
    });

    expect(result.toolResults).toEqual([
      {
        raw: expect.objectContaining({ tool_use_id: "tool-create" }),
        structuredOutput: { task: { id: "1", subject: "Add tests" } },
      },
    ]);
  });

  test("accepts a top-level tool-result envelope with its own ID", () => {
    const result = parseClaudeUserToolResultIngress({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [] },
      tool_use_result: {
        type: "tool_result",
        tool_use_id: "tool-read",
        content: "README contents",
      },
    });

    expect(result.toolResults).toEqual([
      {
        raw: {
          type: "tool_result",
          tool_use_id: "tool-read",
          content: "README contents",
        },
      },
    ]);
  });

  test("accepts TaskStop output without a parent tool-use ID", () => {
    const result = parseClaudeUserToolResultIngress({
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "stop-tool",
            content: "Successfully stopped task",
          },
        ],
      },
      tool_use_result: {
        message: "Successfully stopped task",
        task_id: "agent-1",
        task_type: "local_agent",
      },
    });

    expect(result.toolResults).toEqual([
      {
        raw: expect.objectContaining({ tool_use_id: "stop-tool" }),
        structuredOutput: {
          message: "Successfully stopped task",
          task_id: "agent-1",
          task_type: "local_agent",
        },
      },
    ]);
  });
});
