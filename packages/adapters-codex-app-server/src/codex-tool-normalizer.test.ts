import { describe, expect, test } from "bun:test";
import { toStreamPart } from "./codex-app-server-transcript";
import { normalizeCodexToolInvocation } from "./codex-tool-normalizer";

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
    ["web.run", undefined, "web.run"],
    ["webSearch", undefined, "webSearch"],
    ["web_search_call", undefined, "web_search_call"],
    ["web_search_end", undefined, "web_search_end"],
    ["functions.exec_command", { command: "rg foo src" }, "exec_command"],
    ["functions.exec_command", { command: "cat src/app.ts" }, "exec_command"],
    ["functions.exec_command", { command: "sed -n '1,20p' src/app.ts" }, "exec_command"],
    ["functions.exec_command", { command: "bun test" }, "exec_command"],
    ["functions.apply_patch", undefined, "apply_patch"],
    ["functions.request_user_input", undefined, "request_user_input"],
    ["functions.update_plan", undefined, "update_plan"],
    ["functions.todo_write", undefined, "todo_write"],
    ["functions.write_stdin", undefined, null],
  ])("maps %s to %s", (rawToolName, input, expected) => {
    const part = normalizeCodexToolInvocation({
      messageId: "message-1",
      partId: "part-1",
      callId: "call-1",
      rawToolName,
      input,
    });
    expect(part?.tool ?? null).toBe(expected);
  });

  test.each([
    ["mcp__openducktor__.odt_read_task", undefined, "workflow"],
    ["functions.exec_command", { command: "rg foo src" }, "search"],
    ["functions.exec_command", { command: "cat src/app.ts" }, "read"],
    ["functions.exec_command", { command: "bun test" }, "bash"],
    ["functions.apply_patch", undefined, "file_edit"],
    ["functions.request_user_input", undefined, "question"],
    ["functions.update_plan", undefined, "todo"],
    ["functions.todo_write", undefined, "todo"],
    ["web.run", undefined, "web"],
    ["custom_tool", undefined, "generic"],
    ["functions.write_stdin", undefined, null],
  ])("maps %s to tool type %s", (rawToolName, input, expected) => {
    const part = normalizeCodexToolInvocation({
      messageId: "message-1",
      partId: "part-1",
      callId: "call-1",
      rawToolName,
      input,
    });
    expect(part?.toolType ?? null).toBe(expected);
  });

  test.each([
    ["inProgress", "running"],
    ["in_progress", "running"],
    ["declined", "error"],
  ] as const)("maps Codex status %s to %s", (status, expected) => {
    expect(
      normalizeCodexToolInvocation({
        messageId: "message-1",
        partId: "part-1",
        callId: "call-1",
        rawToolName: "functions.apply_patch",
        status,
      })?.status,
    ).toBe(expected);
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
        toolType: "workflow",
        title: "set_spec",
        input: { taskId: "task-1" },
        output: "ok",
      }),
    );
  });

  test("uses structured MCP tool errors instead of raw JSON output", () => {
    const errorPayload = {
      ok: false,
      error: {
        code: "TASK_TRANSITION_NOT_ALLOWED",
        message: "Transition not allowed for task-1 (bug): closed -> blocked",
      },
    };
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "tool-1",
        server: "openducktor",
        tool: "odt_build_blocked",
        status: "completed",
        arguments: { taskId: "task-1", reason: "needs a product decision" },
        result: {
          isError: true,
          structuredContent: errorPayload,
          content: [{ type: "text", text: JSON.stringify(errorPayload, null, 2) }],
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "odt_build_blocked",
        toolType: "workflow",
        status: "error",
        error: "Transition not allowed for task-1 (bug): closed -> blocked",
      }),
    );
    expect(part).not.toHaveProperty("output");
  });

  test("maps cua_repl MCP calls to the computer use tool type", () => {
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-1",
        server: "cua_repl",
        tool: "js",
        status: "completed",
        arguments: {
          code: "await nodeRepl.emitImage(await tab.screenshot())",
          title: "Inspect the task plan editor",
        },
        result: {
          content: [{ type: "text", text: "Script completed" }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "cua_repl.js",
        toolType: "computer_use",
        status: "completed",
        input: {
          code: "await nodeRepl.emitImage(await tab.screenshot())",
          title: "Inspect the task plan editor",
        },
        output: "Script completed",
        computerUse: {
          action: "Inspect the task plan editor",
          code: "await nodeRepl.emitImage(await tab.screenshot())",
        },
      }),
    );
  });

  test("normalizes js_reset calls to the reset action without code", () => {
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-reset-1",
        server: "cua_repl",
        tool: "js_reset",
        status: "completed",
        arguments: { code: "await tab.click()" },
        result: {
          content: [{ type: "text", text: "setup complete" }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        tool: "cua_repl.js_reset",
        toolType: "computer_use",
        output: "setup complete",
        computerUse: { action: "Reset computer session" },
      }),
    );
  });

  test("extracts cua_repl result images in content order", () => {
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-2",
        server: "cua_repl",
        tool: "js",
        status: "completed",
        arguments: { code: "await nodeRepl.emitImage(await tab.screenshot())" },
        result: {
          content: [
            { type: "text", text: "Script completed" },
            { type: "image", mimeType: "image/png", data: "AAAA" },
            { type: "image", mimeType: "image/jpeg", data: "data:image/jpeg;base64,BBBB" },
            { type: "image", mimeType: "", data: "CCCC" },
            { type: "image", mimeType: "image/png", data: "" },
            { type: "text", text: "Second line" },
          ],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        toolType: "computer_use",
        computerUse: {
          action: "Computer action",
          code: "await nodeRepl.emitImage(await tab.screenshot())",
          images: [
            { mimeType: "image/png", dataBase64: "AAAA" },
            { mimeType: "image/jpeg", dataBase64: "BBBB" },
          ],
        },
        output: "Script completed\nSecond line",
      }),
    );
  });

  test("does not fall back to serialized JSON output for cua_repl calls", () => {
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-3",
        server: "cua_repl",
        tool: "js",
        status: "completed",
        arguments: { code: "await nodeRepl.emitImage(await tab.screenshot())" },
        result: {
          content: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        toolType: "computer_use",
        computerUse: {
          action: "Computer action",
          code: "await nodeRepl.emitImage(await tab.screenshot())",
          images: [{ mimeType: "image/png", dataBase64: "AAAA" }],
        },
      }),
    );
    expect(part).not.toHaveProperty("output");
  });

  test("uses failed cua_repl result text as the error and keeps output empty", () => {
    const manual = "Script error: boom\n\nComputer Use API manual line 1\nline 2";
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-4",
        server: "cua_repl",
        tool: "js",
        status: "failed",
        arguments: { code: "throw new Error('boom')" },
        result: {
          content: [{ type: "text", text: manual }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        toolType: "computer_use",
        status: "error",
        error: manual,
        computerUse: {
          action: "Computer action",
          code: "throw new Error('boom')",
          failureSummary: "boom",
        },
      }),
    );
    expect(part).not.toHaveProperty("output");
  });

  test("keeps the Codex-truncated failed preview as the full error text", () => {
    const manual = `Script error: boom\n\n${"Computer Use API manual\n".repeat(60_000)}`;
    const compact = `{"content":[{"type":"text","text":"${JSON.stringify(manual).slice(1, -1)}"},{"type":"image","data":"${"A".repeat(256 * 1024)}","mimeType":"image/png"}],"structuredContent":null,"isError":true}`;
    const budget = 1_048_576;
    const half = Math.floor(budget / 2);
    const preview = `${compact.slice(0, half)}…${compact.length - budget} chars truncated…${compact.slice(-half)}`;
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-5",
        server: "cua_repl",
        tool: "js",
        status: "failed",
        arguments: { code: "throw new Error('boom')" },
        result: {
          content: [{ type: "text", text: preview }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        toolType: "computer_use",
        status: "error",
        error: preview,
        computerUse: {
          action: "Computer action",
          code: "throw new Error('boom')",
          failureSummary: "boom",
        },
      }),
    );
    expect(part).not.toHaveProperty("output");
  });

  test("recovers the failure line when the preview keys serialize in another order", () => {
    const preview = `{"content":[{"text":"Script error: boom\\n\\nManual…510000 chars truncated…tail","type":"text"}],"structuredContent":null,"isError":true}`;
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-6",
        server: "cua_repl",
        tool: "js",
        status: "failed",
        arguments: { code: "throw new Error('boom')" },
        result: {
          content: [{ type: "text", text: preview }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        computerUse: expect.objectContaining({ failureSummary: "boom" }),
      }),
    );
  });

  test("states the truncation when the preview has no readable failure line", () => {
    const preview = `{"content":[{"text":"\\\\…500000 chars truncated…tail","type":"text"}],"structuredContent":null,"isError":true}`;
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-7",
        server: "cua_repl",
        tool: "js",
        status: "failed",
        arguments: { code: "throw new Error('boom')" },
        result: {
          content: [{ type: "text", text: preview }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        computerUse: expect.objectContaining({
          failureSummary: "Computer action failed. Codex truncated its diagnostics.",
        }),
      }),
    );
  });

  test("recovers the failure line when the preview omits the error flag", () => {
    const preview = `{"content":[{"type":"text","text":"Script error: boom\\n\\nManual…510000 chars truncated…tail"}],"structuredContent":null}`;
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-9",
        server: "cua_repl",
        tool: "js",
        status: "failed",
        arguments: { code: "throw new Error('boom')" },
        result: {
          content: [{ type: "text", text: preview }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        computerUse: expect.objectContaining({ failureSummary: "boom" }),
      }),
    );
  });

  test("bounds the failure summary line", () => {
    const longLine = "boom ".repeat(100).trim();
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-10",
        server: "cua_repl",
        tool: "js",
        status: "failed",
        arguments: { code: "1 + 1" },
        result: {
          content: [{ type: "text", text: longLine }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    if (!part || part.kind !== "tool") {
      throw new Error("Expected a tool part.");
    }
    expect(part.computerUse?.failureSummary).toHaveLength(200);
    expect(part.computerUse?.failureSummary?.endsWith("…")).toBe(true);
  });

  test("reads the top-level text on non-text cua_repl blocks", () => {
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-11",
        server: "cua_repl",
        tool: "js",
        status: "failed",
        arguments: { code: "await nodeRepl.emitImage(await tab.screenshot())" },
        result: {
          content: [
            {
              type: "image",
              mimeType: "image/png",
              data: "AAAA",
              text: "Script completed\nOutput:\nimage-side output",
            },
          ],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        error: "Script completed\nOutput:\nimage-side output",
        computerUse: {
          action: "Computer action",
          code: "await nodeRepl.emitImage(await tab.screenshot())",
          failureSummary: "Script completed",
          images: [{ mimeType: "image/png", dataBase64: "AAAA" }],
        },
      }),
    );
    expect(part).not.toHaveProperty("output");
  });

  test("uses the MCP error message as the failure summary", () => {
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "cua-8",
        server: "cua_repl",
        tool: "js",
        status: "failed",
        arguments: { code: "await tab.click()" },
        error: { message: "MCP error -32000: connection closed" },
        result: null,
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        error: "MCP error -32000: connection closed",
        computerUse: expect.objectContaining({
          failureSummary: "MCP error -32000: connection closed",
        }),
      }),
    );
  });

  test("keeps other MCP servers on the generic tool presentation", () => {
    const part = toStreamPart(
      {
        type: "mcpToolCall",
        id: "node-1",
        server: "node_repl",
        tool: "js",
        status: "completed",
        arguments: { code: "1 + 1" },
        result: {
          content: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
          structuredContent: null,
          _meta: null,
        },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        tool: "node_repl.js",
        toolType: "generic",
      }),
    );
    expect(part).not.toHaveProperty("computerUse");
  });

  test("uses structured dynamic tool errors instead of raw JSON output", () => {
    const part = toStreamPart(
      {
        type: "dynamicToolCall",
        id: "tool-1",
        namespace: "functions",
        tool: "exec_command",
        status: "completed",
        success: true,
        arguments: { cmd: "bun test" },
        contentItems: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: { message: "Command failed with exit code 1" },
            }),
          },
        ],
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "exec_command",
        toolType: "bash",
        status: "error",
        error: "Command failed with exit code 1",
      }),
    );
    expect(part).not.toHaveProperty("output");
  });

  test("renders exact Codex file changes as completed tool cards", () => {
    const part = toStreamPart(
      {
        type: "fileChange",
        id: "change-1",
        status: "completed",
        changes: [
          {
            path: "src/app.ts",
            kind: { type: "update", move_path: null },
            diff: "@@ -1 +1 @@\n-old\n+new",
          },
        ],
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "apply_patch",
        toolType: "file_edit",
        status: "completed",
        output: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
        fileDiffs: [
          {
            file: "src/app.ts",
            type: "modified",
            additions: 1,
            deletions: 1,
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
          },
        ],
      }),
    );
    expect(part).not.toHaveProperty("error");
  });

  test("marks malformed Codex file changes as tool errors", () => {
    const part = toStreamPart(
      {
        type: "fileChange",
        id: "change-1",
        status: "completed",
        changes: [
          {
            path: "   ",
            kind: { type: "update", move_path: null },
            diff: "@@ -1 +1 @@\n-old\n+new",
          },
        ],
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "apply_patch",
        toolType: "file_edit",
        status: "error",
        error: "Malformed Codex file change: entry 0 has empty file path.",
      }),
    );
    expect(part).not.toHaveProperty("input");
    expect(part).not.toHaveProperty("output");
    expect(part).not.toHaveProperty("fileDiffs");
  });

  test("keeps non-renderable Codex modified file changes out of tool errors", () => {
    const part = toStreamPart(
      {
        type: "fileChange",
        id: "change-1",
        status: "completed",
        changes: [
          {
            path: "/Users/maxsky5/.openducktor-local/worktrees/fairnest/apps/web/__tests__/contexts/AuthContext.test.tsx",
            kind: { type: "update", move_path: null },
            diff: "import { render, screen } from '@testing-library/react';\nfunction AuthConsumer() {}\n",
          },
        ],
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "apply_patch",
        toolType: "file_edit",
        status: "completed",
        fileDiffs: [
          {
            file: "/Users/maxsky5/.openducktor-local/worktrees/fairnest/apps/web/__tests__/contexts/AuthContext.test.tsx",
            type: "modified",
            additions: 0,
            deletions: 0,
            diff: "",
          },
        ],
      }),
    );
    expect(part).not.toHaveProperty("error");
    expect(part).not.toHaveProperty("input");
    expect(part).not.toHaveProperty("output");
  });

  test("attaches structured file changes to dynamic apply_patch calls", () => {
    const patch = `*** Begin Patch
*** Update File: src/app.ts
@@
-old
+new
*** End Patch`;
    const part = toStreamPart(
      {
        type: "dynamicToolCall",
        id: "patch-1",
        namespace: "functions",
        tool: "apply_patch",
        arguments: { patch },
        success: true,
        status: "completed",
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "apply_patch",
        toolType: "file_edit",
        input: { patch },
        output: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new",
        fileDiffs: [
          {
            file: "src/app.ts",
            type: "modified",
            additions: 1,
            deletions: 1,
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new\n",
          },
        ],
      }),
    );
  });

  test("attaches structured file changes to dynamic apply_patch arguments", () => {
    const patch = `*** Begin Patch
*** Add File: src/new.ts
+created
*** End Patch`;
    const part = toStreamPart(
      {
        type: "dynamicToolCall",
        id: "patch-1",
        namespace: "functions",
        tool: "apply_patch",
        arguments: { patch },
        success: true,
        status: "completed",
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "apply_patch",
        toolType: "file_edit",
        input: { patch },
        output: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+created",
        fileDiffs: [
          {
            file: "src/new.ts",
            type: "added",
            additions: 1,
            deletions: 0,
            diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+created\n",
          },
        ],
      }),
    );
  });

  test("does not echo non-renderable apply_patch input as tool output", () => {
    const patch = `*** Begin Patch
*** Update File: src/app.ts
import { render } from "@testing-library/react";
function AuthConsumer() {}
*** End Patch`;
    const part = toStreamPart(
      {
        type: "dynamicToolCall",
        id: "patch-1",
        namespace: "functions",
        tool: "apply_patch",
        arguments: { patch },
        success: true,
        status: "completed",
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "apply_patch",
        toolType: "file_edit",
        input: { patch },
        fileDiffs: [
          {
            file: "src/app.ts",
            type: "modified",
            additions: 0,
            deletions: 0,
            diff: "",
          },
        ],
      }),
    );
    expect(part).not.toHaveProperty("output");
  });

  test("parses non-patch dynamic tool string input without treating it as a patch", () => {
    const part = toStreamPart(
      {
        type: "dynamicToolCall",
        id: "question-1",
        namespace: "functions",
        tool: "request_user_input",
        arguments: JSON.stringify({
          requestId: "32",
          questions: [{ question: "Pick a mode" }],
        }),
        contentItems: [{ type: "text", text: "answered" }],
        success: true,
        status: "completed",
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "request_user_input",
        toolType: "question",
        title: "Question",
        input: { requestId: "32", questions: [{ question: "Pick a mode" }] },
        output: expect.stringContaining("answered"),
        preview: "Pick a mode",
      }),
    );
    expect(part).not.toEqual(expect.objectContaining({ output: expect.stringContaining("patch") }));
  });

  test("keeps zero command timing values when Codex provides them", () => {
    const part = toStreamPart(
      {
        type: "commandExecution",
        id: "cmd-1",
        command: "true",
        cwd: "/repo",
        status: "completed",
        commandActions: [],
        aggregatedOutput: "",
        startedAtMs: 0,
        durationMs: 0,
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        startedAtMs: 0,
        endedAtMs: 0,
      }),
    );
  });

  test("keeps start-only timing only when the live start path opts in", () => {
    const item = {
      type: "commandExecution",
      id: "cmd-1",
      command: "true",
      cwd: "/repo",
      status: "running",
      commandActions: [],
      aggregatedOutput: "",
      startedAtMs: 1000,
    };

    expect(toStreamPart(item, "message-history")[0]).not.toEqual(
      expect.objectContaining({ startedAtMs: expect.any(Number) }),
    );
    expect(toStreamPart(item, "message-live", { allowStartedAtOnly: true })[0]).toEqual(
      expect.objectContaining({ startedAtMs: 1000 }),
    );
  });

  test("rejects malformed command timing fields when Codex provides them", () => {
    expect(() =>
      toStreamPart(
        {
          type: "commandExecution",
          id: "cmd-1",
          command: "true",
          cwd: "/repo",
          status: "completed",
          commandActions: [],
          aggregatedOutput: "",
          durationMs: "0",
        },
        "message-live",
      ),
    ).toThrow("Codex tool durationMs must be a finite number when present.");
  });

  test("uses Codex web search action details when top-level query is absent", () => {
    const part = toStreamPart(
      {
        type: "webSearch",
        id: "web-1",
        action: { type: "search", query: null, queries: ["actual query"] },
      },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "webSearch",
        toolType: "web",
        input: { query: "actual query" },
        preview: "actual query",
      }),
    );
  });

  test("does not invent a generic web search input when Codex omits search details", () => {
    const part = toStreamPart(
      { type: "webSearch", id: "web-1", action: { type: "other" } },
      "message-live",
    )[0];

    expect(part).toEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "webSearch",
        toolType: "web",
      }),
    );
    expect(part).not.toEqual(expect.objectContaining({ input: { query: "web search" } }));
    expect(part).not.toEqual(expect.objectContaining({ preview: "web search" }));
  });

  test("marks synthetic display parts explicitly", () => {
    const part = toStreamPart(
      { type: "plan", id: "plan-1", text: "1. Inspect\n2. Fix" },
      "message-live",
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
