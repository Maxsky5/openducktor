import { describe, expect, test } from "bun:test";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { filterClaudeHistoryMessages } from "./claude-agent-sdk-history-import";
import { parseClaudeUserToolResultIngress } from "./claude-agent-sdk-ingress-schemas";
import { createClaudePostToolUseHook } from "./claude-agent-sdk-post-tool-use-hook";
import { createClaudePreToolUseHook } from "./claude-agent-sdk-pre-tool-use-hook";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";

describe("Claude SDK ingress", () => {
  test("rejects malformed history entries before history projection", () => {
    let error: unknown;
    try {
      Reflect.apply(filterClaudeHistoryMessages, undefined, [
        [{ type: "assistant", message: new Date() }],
      ]);
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({
      _tag: "HostValidationError",
      field: "claudeSessionHistoryEntry",
    });
  });

  test("rejects malformed pre-tool input before authorization", async () => {
    const hook = createClaudePreToolUseHook({ session: createClaudeSession() });

    await expect(
      Reflect.apply(hook, undefined, [
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: "pwd",
          tool_use_id: "tool-1",
        },
        "tool-1",
        { signal: new AbortController().signal },
      ]),
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

    await expect(
      Reflect.apply(hook, undefined, [
        {
          hook_event_name: "PostToolUse",
          tool_name: "Edit",
          tool_input: { file_path: "src/file.ts" },
          tool_response: new Date(),
          tool_use_id: "tool-1",
        },
        "tool-1",
        { signal: new AbortController().signal },
      ]),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "claudePostToolUse",
    });
  });

  test("rejects malformed tool results before transcript projection", () => {
    const session = createEventTestSession();
    let error: unknown;
    try {
      handleClaudeSdkMessage({
        emit: () => {},
        modelSelection: (model) => ({
          providerId: "claude",
          modelId: model,
          runtimeKind: "claude",
        }),
        message: claudeSdkMessageFixture({
          type: "user",
          message: { role: "user", content: [] },
          parent_tool_use_id: "tool-1",
          tool_use_result: "not a tool result object",
          uuid: "user-1",
        }),
        session,
        timestamp: "2026-08-21T12:00:00.000Z",
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toMatchObject({
      _tag: "HostValidationError",
      field: "claudeUserToolResult",
    });
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
