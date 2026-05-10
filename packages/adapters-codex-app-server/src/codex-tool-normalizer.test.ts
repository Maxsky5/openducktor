import { describe, expect, test } from "bun:test";
import { toStreamPart } from "./codex-app-server-transcript";
import { canonicalCodexToolName, normalizeCodexToolInvocation } from "./codex-tool-normalizer";

describe("Codex tool normalization", () => {
  test.each([
    ["mcp__openducktor__.odt_read_task", undefined, "odt_read_task"],
    ["mcp__openducktor__odt_read_task", undefined, "odt_read_task"],
    ["mcp/openducktor/odt_read_task", undefined, "odt_read_task"],
    ["openducktor.odt_read_task", undefined, "odt_read_task"],
    ["odt_read_task", undefined, "odt_read_task"],
    ["mcp__openducktor__.odt_set_spec", undefined, "odt_set_spec"],
    ["mcp__openducktor__.odt_set_plan", undefined, "odt_set_plan"],
    ["other_server.odt_read_task", undefined, "other_server.odt_read_task"],
    ["web.run", undefined, "websearch"],
    ["webSearch", undefined, "websearch"],
    ["web_search_call", undefined, "websearch"],
    ["web_search_end", undefined, "websearch"],
    ["functions.exec_command", { command: "rg foo src" }, "search"],
    ["functions.exec_command", { command: "cat src/app.ts" }, "read"],
    ["functions.exec_command", { command: "sed -n '1,20p' src/app.ts" }, "read"],
    ["functions.exec_command", { command: "bun test" }, "bash"],
    ["functions.apply_patch", undefined, "apply_patch"],
    ["functions.request_user_input", undefined, "request_user_input"],
    ["functions.update_plan", undefined, "update_plan"],
    ["functions.todo_write", undefined, "todo_write"],
    ["functions.write_stdin", undefined, null],
  ])("maps %s to %s", (rawToolName, input, expected) => {
    expect(canonicalCodexToolName(rawToolName, input)).toBe(expected);
  });

  test("normalizes ODT tool display identity", () => {
    expect(
      normalizeCodexToolInvocation({
        messageId: "message-1",
        partId: "part-1",
        callId: "call-1",
        rawToolName: "mcp__openducktor__.odt_set_spec",
        input: { taskId: "task-1" },
        output: "ok",
        status: "completed",
      }),
    ).toEqual(
      expect.objectContaining({
        tool: "odt_set_spec",
        title: "set_spec",
        input: { taskId: "task-1" },
        output: "ok",
      }),
    );
  });

  test("parses non-patch dynamic tool string input without treating it as a patch", () => {
    const part = toStreamPart(
      {
        type: "dynamicToolCall",
        id: "question-1",
        namespace: "functions",
        tool: "request_user_input",
        input: JSON.stringify({ requestId: "32", questions: [{ question: "Pick a mode" }] }),
        contentItems: [{ type: "text", text: "answered" }],
        success: true,
        status: "completed",
      },
      "message-live",
      "question-1",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "request_user_input",
        title: "Question",
        input: { requestId: "32", questions: [{ question: "Pick a mode" }] },
        output: expect.stringContaining("answered"),
        preview: "Pick a mode",
      }),
    );
    expect(part).not.toEqual(expect.objectContaining({ output: expect.stringContaining("patch") }));
  });

  test("uses Codex web search action details when top-level query is absent", () => {
    const part = toStreamPart(
      {
        type: "webSearch",
        id: "web-1",
        action: { type: "search", query: null, queries: ["actual query"] },
      },
      "message-live",
      "web-1",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "websearch",
        input: { query: "actual query" },
        preview: "actual query",
      }),
    );
  });

  test("does not invent a generic web search input when Codex omits search details", () => {
    const part = toStreamPart(
      { type: "webSearch", id: "web-1", action: { type: "other" } },
      "message-live",
      "web-1",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "websearch",
      }),
    );
    expect(part).not.toEqual(expect.objectContaining({ input: { query: "web search" } }));
    expect(part).not.toEqual(expect.objectContaining({ preview: "web search" }));
  });

  test("marks synthetic display parts explicitly", () => {
    const part = toStreamPart(
      { type: "plan", id: "plan-1", text: "1. Inspect\n2. Fix" },
      "message-live",
      "plan-1",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "plan",
        title: "Plan",
        metadata: expect.objectContaining({ syntheticCodexToolPart: true }),
      }),
    );
  });
});
