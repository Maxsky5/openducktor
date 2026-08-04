import { describe, expect, test } from "bun:test";
import {
  appendClaudeStreamToolInputJson,
  consumeClaudeStreamEmittedToolInput,
  rememberClaudeStreamToolStart,
} from "./claude-agent-sdk-tool-input-stream";

describe("Claude streamed tool input", () => {
  test("releases a streamed tool after its final assistant envelope consumes it", () => {
    const session = {};
    rememberClaudeStreamToolStart(session, 1, {
      blockType: "tool_use",
      callId: "tool-1",
      input: {},
      toolName: "Bash",
    });
    expect(appendClaudeStreamToolInputJson(session, 1, '{"command":"bun test"}')).toMatchObject({
      callId: "tool-1",
      input: { command: "bun test" },
    });

    expect(consumeClaudeStreamEmittedToolInput(session, "tool-1", { command: "bun test" })).toBe(
      true,
    );
    expect(consumeClaudeStreamEmittedToolInput(session, "tool-1", { command: "bun test" })).toBe(
      false,
    );
    expect(appendClaudeStreamToolInputJson(session, 1, '{"description":"tests"}')).toBeNull();
  });
});
