import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { readHtmlPreviewToolCall } from "./html-preview-tool";

const PREVIEW_ID = "11111111-1111-4111-8111-111111111111";

const output = JSON.stringify({
  htmlPreview: {
    previewId: PREVIEW_ID,
    title: "Weekly report",
    byteSize: 128,
  },
});

const call = (overrides: Partial<ToolMeta> = {}): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "odt_publish_html",
  toolType: "generic",
  status: "completed",
  input: { title: "Weekly report", path: "/tmp/report.html" },
  output,
  ...overrides,
});

describe("readHtmlPreviewToolCall", () => {
  test("reads a completed publication reference regardless of tool name prefix or omitted input", () => {
    expect(readHtmlPreviewToolCall(call())).toEqual({
      previewId: PREVIEW_ID,
      title: "Weekly report",
      byteSize: 128,
    });
    expect(
      readHtmlPreviewToolCall(
        call({
          tool: "mcp__openducktor__odt_publish_html",
          detailsOmitted: { input: true },
        }),
      ),
    ).toEqual({
      previewId: PREVIEW_ID,
      title: "Weekly report",
      byteSize: 128,
    });
  });

  test("keeps a failed, unfinished, or malformed call an ordinary tool row", () => {
    expect(readHtmlPreviewToolCall(call({ status: "running" }))).toBeNull();
    expect(readHtmlPreviewToolCall(call({ status: "error" }))).toBeNull();
    expect(readHtmlPreviewToolCall(call({ output: '{"ok":false}' }))).toBeNull();
    expect(readHtmlPreviewToolCall(call({ output: '{"htmlPreview":{"byteSize":10}}' }))).toBeNull();
    const { output: _output, ...withoutOutput } = call();
    expect(readHtmlPreviewToolCall(withoutOutput)).toBeNull();
    expect(readHtmlPreviewToolCall(call({ tool: "odt_browser_open" }))).toBeNull();
  });
});
