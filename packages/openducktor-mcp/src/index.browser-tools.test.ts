import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ODT_BROWSER_TOOL_NAMES,
  ODT_EXTERNAL_MCP_TOOL_NAMES,
  ODT_MCP_TOOL_NAMES,
} from "@openducktor/contracts";
import {
  BROWSER_CLOSE_FAILURE,
  browserRequests,
  connectClientWithEnv,
  createTransport,
  expectToolError,
  MANAGED_TOOLS,
  startMockBridge,
  TAB_ID,
  useMcpServerTestLifecycle,
} from "./test-support/mcp-server-harness";

useMcpServerTestLifecycle();

describe("browser tools", () => {
  test("external clients without ODT_ALLOWED_TOOLS never list browser tools", async () => {
    const bridge = await startMockBridge();
    const client = await connectClientWithEnv(bridge.url, {});

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([...ODT_EXTERNAL_MCP_TOOL_NAMES]);
  });

  test("gives server instructions only to clients that may pass workspaceId", async () => {
    const bridge = await startMockBridge();
    const scoped = await connectClientWithEnv(bridge.url, {});
    const unscopedTransport = await createTransport(bridge.url);
    const unscoped = new Client({ name: "odt-mcp-test", version: "1.0.0" });
    await unscoped.connect(unscopedTransport);

    // Codex repeats server instructions in front of each tool description.
    expect(scoped.getInstructions()).toBeUndefined();
    expect(unscoped.getInstructions()).toBe(
      "Pass a workspaceId from odt_get_workspaces when no startup workspace is set, or to use another workspace.",
    );
    await unscoped.close();
  });

  test("managed sessions list browser tools as native-content tools", async () => {
    const bridge = await startMockBridge();
    const client = await connectClientWithEnv(bridge.url, {
      ODT_ALLOWED_TOOLS: MANAGED_TOOLS,
      ODT_RUNTIME_KIND: "codex",
    });

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([...ODT_MCP_TOOL_NAMES]);
    for (const toolName of ODT_BROWSER_TOOL_NAMES) {
      const tool = tools.find((entry) => entry.name === toolName);
      expect(tool).not.toHaveProperty("outputSchema");
      expect(tool?.inputSchema.properties ?? {}).not.toHaveProperty("workspaceId");
    }
    const snapshot = tools.find((tool) => tool.name === "odt_browser_snapshot");
    // The listing drops the schema URL and the UUID pattern. The server still validates them.
    expect(snapshot?.inputSchema).not.toHaveProperty("$schema");
    expect(snapshot?.inputSchema.properties?.tabId).toEqual({
      type: "string",
      format: "uuid",
      description: "From odt_browser_list or odt_browser_open.",
    });
    expect(
      tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name),
    ).toEqual([
      "odt_get_workspaces",
      "odt_search_tasks",
      "odt_read_task",
      "odt_read_task_assets",
      "odt_read_task_documents",
      "odt_browser_list",
      "odt_browser_snapshot",
      "odt_browser_screenshot",
      "odt_browser_console",
      "odt_browser_wait",
    ]);
  });

  test.each([
    {
      runtime: "opencode",
      env: { ODT_RUNTIME_KIND: "opencode" },
      meta: { "ai.opencode/sessionID": "ses_child" },
      runtimeSessionId: "ses_child",
    },
    {
      runtime: "codex",
      env: { ODT_RUNTIME_KIND: "codex" },
      meta: { threadId: "thread-1", sessionId: "session-1" },
      runtimeSessionId: "thread-1",
    },
    {
      runtime: "claude",
      env: { ODT_RUNTIME_KIND: "claude", ODT_RUNTIME_SESSION_ID: "claude-session-1" },
      meta: { threadId: "forged-thread" },
      runtimeSessionId: "claude-session-1",
    },
  ])("sends the $runtime calling session to the host", async (testCase) => {
    const bridge = await startMockBridge();
    const client = await connectClientWithEnv(bridge.url, {
      ODT_ALLOWED_TOOLS: MANAGED_TOOLS,
      ...testCase.env,
    });

    const result = await client.callTool({
      name: "odt_browser_click",
      arguments: { tabId: TAB_ID, ref: "e12" },
      _meta: testCase.meta,
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Clicked e12" }]);
    expect(browserRequests(bridge.requests)).toEqual([
      {
        url: "/invoke/odt_browser_click",
        body: {
          tabId: TAB_ID,
          ref: "e12",
          workspaceId: "repo",
          caller: { runtime: testCase.runtime, runtimeSessionId: testCase.runtimeSessionId },
        },
      },
    ]);
  });

  test.each([
    {
      name: "a process that OpenDucktor did not start",
      env: {},
      meta: { threadId: "thread-1" },
      reason: "this MCP server has no ODT_RUNTIME_KIND",
    },
    {
      name: "an OpenCode call without a session ID",
      env: { ODT_RUNTIME_KIND: "opencode" },
      meta: { sessionID: "ses_1" },
      reason: '_meta["ai.opencode/sessionID"]',
    },
    {
      name: "a Codex call with only turn metadata",
      env: { ODT_RUNTIME_KIND: "codex" },
      meta: { "x-codex-turn-metadata": { thread_id: "thread-1" } },
      reason: "_meta.threadId",
    },
  ])("fails the call for $name", async (testCase) => {
    const bridge = await startMockBridge();
    const client = await connectClientWithEnv(bridge.url, {
      ODT_ALLOWED_TOOLS: MANAGED_TOOLS,
      ...testCase.env,
    });

    const result = await client.callTool({
      name: "odt_browser_list",
      arguments: {},
      _meta: testCase.meta,
    });

    const { message } = expectToolError(result);
    expect(message).toContain("Browser tools need a managed OpenDucktor session");
    expect(message).toContain(testCase.reason);
    expect(browserRequests(bridge.requests)).toEqual([]);
  });

  test("a Claude process needs its session ID at startup", async () => {
    const bridge = await startMockBridge();

    await expect(
      connectClientWithEnv(bridge.url, {
        ODT_ALLOWED_TOOLS: MANAGED_TOOLS,
        ODT_RUNTIME_KIND: "claude",
      }),
    ).rejects.toThrow("ODT_RUNTIME_SESSION_ID must name the Claude session");
  });

  test("an unknown runtime kind fails at startup", async () => {
    const bridge = await startMockBridge();

    await expect(
      connectClientWithEnv(bridge.url, {
        ODT_ALLOWED_TOOLS: MANAGED_TOOLS,
        ODT_RUNTIME_KIND: "cursor",
      }),
    ).rejects.toThrow("ODT_RUNTIME_KIND must be opencode, codex, or claude.");
  });

  test("screenshot returns text and image content without structured output", async () => {
    const bridge = await startMockBridge();
    const client = await connectClientWithEnv(bridge.url, {
      ODT_ALLOWED_TOOLS: MANAGED_TOOLS,
      ODT_RUNTIME_KIND: "codex",
    });

    const result = await client.callTool({
      name: "odt_browser_screenshot",
      arguments: { tabId: TAB_ID },
      _meta: { threadId: "thread-1" },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      { type: "text", text: "Screenshot of tab 1" },
      { type: "image", data: "AQID", mimeType: "image/png" },
    ]);
  });

  test("host browser failures reach the agent with their message", async () => {
    const bridge = await startMockBridge();
    const client = await connectClientWithEnv(bridge.url, {
      ODT_ALLOWED_TOOLS: MANAGED_TOOLS,
      ODT_RUNTIME_KIND: "codex",
    });

    const result = await client.callTool({
      name: "odt_browser_close",
      arguments: { tabId: TAB_ID },
      _meta: { threadId: "thread-1" },
    });

    expect(expectToolError(result).message).toBe(BROWSER_CLOSE_FAILURE);
  });

  test("managed sessions cannot pass workspaceId to browser tools", async () => {
    const bridge = await startMockBridge();
    const client = await connectClientWithEnv(bridge.url, {
      ODT_ALLOWED_TOOLS: MANAGED_TOOLS,
      ODT_RUNTIME_KIND: "codex",
    });

    const result = await client.callTool({
      name: "odt_browser_list",
      arguments: { workspaceId: "other-repo" },
      _meta: { threadId: "thread-1" },
    });

    expect(expectToolError(result).message).toContain(
      "workspaceId is fixed by the startup workspace",
    );
    expect(browserRequests(bridge.requests)).toEqual([]);
  });
});
