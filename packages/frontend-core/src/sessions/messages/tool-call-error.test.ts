import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import {
  readToolCallError,
  TOOL_CALL_ERROR_IN_DETAILS_MESSAGE,
  TOOL_CALL_FAILED_MESSAGE,
} from "./tool-call-error";

const call = (overrides: Partial<ToolMeta>): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "odt_set_pull_request",
  toolType: "workflow",
  status: "completed",
  ...overrides,
});

describe("readToolCallError", () => {
  const envelope = JSON.stringify(
    {
      ok: false,
      error: {
        code: "ODT_HOST_BRIDGE_ERROR",
        message: "Task task-1 already has pull request #141.",
        details: { taskId: "task-1" },
      },
    },
    null,
    2,
  );

  test("reads the message of an ODT error envelope and keeps its JSON as the detail", () => {
    expect(readToolCallError(call({ status: "error", error: envelope }))).toEqual({
      message: "Task task-1 already has pull request #141.",
      detail: envelope,
    });
    expect(readToolCallError(call({ status: "error", output: envelope }))?.message).toBe(
      "Task task-1 already has pull request #141.",
    );
  });

  test("shows plain error text as the message, and other JSON never", () => {
    expect(
      readToolCallError(call({ status: "error", error: " Runtime connection lost. " })),
    ).toEqual({
      message: "Runtime connection lost.",
      detail: null,
    });
    expect(readToolCallError(call({ status: "error", error: '{"reason":"x"}' }))).toEqual({
      message: TOOL_CALL_ERROR_IN_DETAILS_MESSAGE,
      detail: '{"reason":"x"}',
    });
    expect(readToolCallError(call({ status: "error" }))).toEqual({
      message: TOOL_CALL_FAILED_MESSAGE,
      detail: null,
    });
  });

  test("reads no error for a call that did not fail, and the same error for any tool", () => {
    expect(readToolCallError(call({ status: "completed", output: envelope }))).toBeNull();
    expect(
      readToolCallError(call({ status: "error", error: "Tool execution aborted" })),
    ).toBeNull();
    expect(readToolCallError(call({ tool: "bash", status: "error", error: "boom" }))).toEqual({
      message: "boom",
      detail: null,
    });
  });
});
