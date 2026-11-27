import { describe, expect, test } from "bun:test";
import type { RequestMeta } from "@modelcontextprotocol/sdk/types.js";
import {
  ODT_HTML_PREVIEW_MAX_BYTES,
  ODT_HTML_PREVIEW_TITLE_MAX_CHARS,
  odtHtmlPreviewByteSize,
  odtPublishHtmlResultSchema,
} from "@openducktor/contracts";
import {
  connectClientWithEnv,
  MANAGED_TOOLS,
  startMockBridge,
  useMcpServerTestLifecycle,
} from "./test-support/mcp-server-harness";

useMcpServerTestLifecycle();

const publish = async (
  args: { title: string; html?: string; path?: string },
  meta: RequestMeta = { threadId: "thread-1" },
) => {
  const bridge = await startMockBridge();
  const client = await connectClientWithEnv(bridge.url, {
    ODT_ALLOWED_TOOLS: MANAGED_TOOLS,
    ODT_RUNTIME_KIND: "codex",
  });
  try {
    const result = await client.callTool({
      name: "odt_publish_html",
      arguments: args,
      _meta: meta,
    });
    return { bridge, result };
  } finally {
    await client.close();
  }
};

describe("odt_publish_html", () => {
  test("forwards inline html and calling session identity to the host bridge", async () => {
    const html = "<title>Report</title><p>Ready</p>";
    const { bridge, result } = await publish({ title: "Weekly report", html });

    expect(result.isError).not.toBe(true);
    const text = result.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") throw new Error("Expected a text result.");
    const expected = {
      htmlPreview: {
        previewId: "11111111-1111-4111-8111-111111111111",
        title: "Weekly report",
        byteSize: odtHtmlPreviewByteSize(html),
      },
    };
    expect(odtPublishHtmlResultSchema.parse(JSON.parse(text.text))).toEqual(expected);
    expect(result.structuredContent).toEqual(expected);
    expect(bridge.requests).toEqual([
      { url: "/invoke/odt_mcp_ready", body: {} },
      { url: "/invoke/odt_get_workspaces", body: {} },
      {
        url: "/invoke/odt_publish_html",
        body: {
          workspaceId: "repo",
          title: "Weekly report",
          html,
          caller: { runtime: "codex", runtimeSessionId: "thread-1" },
        },
      },
    ]);
  });

  test("forwards a local file path to the host bridge", async () => {
    const { bridge, result } = await publish({
      title: "Disk report",
      path: "/tmp/report.html",
    });

    expect(result.isError).not.toBe(true);
    expect(bridge.requests.at(-1)).toEqual({
      url: "/invoke/odt_publish_html",
      body: {
        workspaceId: "repo",
        title: "Disk report",
        path: "/tmp/report.html",
        caller: { runtime: "codex", runtimeSessionId: "thread-1" },
      },
    });
  });

  test("rejects invalid combinations, blank inputs, and size overflows before calling the host", async () => {
    for (const badArgs of [
      { title: " ", html: "<p>Ready</p>" },
      { title: "Weekly report", html: "  " },
      { title: "Weekly report" },
      { title: "Weekly report", html: "<p>Ready</p>", path: "/tmp/report.html" },
      { title: "Weekly report", html: "a".repeat(ODT_HTML_PREVIEW_MAX_BYTES + 1) },
      {
        title: "t".repeat(ODT_HTML_PREVIEW_TITLE_MAX_CHARS + 1),
        html: "<p>Ready</p>",
      },
    ]) {
      const { bridge, result } = await publish(badArgs);
      expect(result.isError).toBe(true);
      expect(bridge.requests.some((req) => req.url === "/invoke/odt_publish_html")).toBe(false);
    }
  });
});
