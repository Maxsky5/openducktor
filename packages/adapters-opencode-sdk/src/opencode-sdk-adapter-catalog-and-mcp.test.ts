import { describe, expect, test } from "bun:test";

import { defaultRepoRuntimeInput, makeMockClient, OpencodeSdkAdapter } from "./test-support";

describe("OpencodeSdkAdapter catalog and mcp", () => {
  test("listAvailableModels returns provider models and primary agents", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        {
          name: "Hephaestus",
          description: "Deep agent",
          mode: "primary",
          hidden: false,
          native: false,
          color: "#f59e0b",
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const catalog = await adapter.listAvailableModels({
      ...defaultRepoRuntimeInput,
    });

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]).toMatchObject({
      providerId: "openai",
      modelId: "gpt-5",
      contextWindow: 400_000,
      outputLimit: 32_000,
    });
    expect(catalog.profiles ?? []).toHaveLength(1);
    expect(catalog.profiles?.[0]).toMatchObject({
      id: "Hephaestus",
      label: "Hephaestus",
      mode: "primary",
      color: "#f59e0b",
    });
  });

  test("listAvailableModels applies OpenCode default colors for native agents without explicit color", async () => {
    const expectedNativeDefaultColors = [
      { id: "build", color: "var(--icon-agent-build-base)" },
      { id: "plan", color: "var(--icon-agent-plan-base)" },
    ] as const;

    const mock = makeMockClient({
      agentsResponse: expectedNativeDefaultColors.map((entry) => ({
        name: entry.id,
        description: `Native ${entry.id} agent`,
        mode: entry.id === "plan" ? "primary" : "subagent",
        hidden: entry.id !== "plan",
        native: true,
      })),
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const catalog = await adapter.listAvailableModels({
      ...defaultRepoRuntimeInput,
    });

    expect(catalog.profiles).toEqual(
      expect.arrayContaining(
        expectedNativeDefaultColors.map((entry) =>
          expect.objectContaining({
            id: entry.id,
            label: entry.id,
            color: entry.color,
          }),
        ),
      ),
    );
  });

  test("listAvailableModels does not synthesize colors for unsupported native names", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        {
          name: "ask",
          description: "Native ask agent",
          mode: "subagent",
          hidden: true,
          native: true,
        },
        {
          name: "docs",
          description: "Native docs agent",
          mode: "subagent",
          hidden: true,
          native: true,
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const catalog = await adapter.listAvailableModels({
      ...defaultRepoRuntimeInput,
    });

    expect(catalog.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ask", label: "ask" }),
        expect.objectContaining({ id: "docs", label: "docs" }),
      ]),
    );

    const ask = catalog.profiles?.find((entry) => entry.id === "ask");
    const docs = catalog.profiles?.find((entry) => entry.id === "docs");
    expect(ask).toBeDefined();
    expect(docs).toBeDefined();
    expect(ask).not.toHaveProperty("color");
    expect(docs).not.toHaveProperty("color");
  });

  test("listAvailableModels keeps explicit native color and skips fallback for non-native reserved names", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        {
          name: "build",
          description: "Native build agent",
          mode: "subagent",
          hidden: true,
          native: true,
          color: "#123456",
        },
        {
          name: "plan",
          description: "Custom plan profile",
          mode: "primary",
          hidden: false,
          native: false,
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const catalog = await adapter.listAvailableModels({
      ...defaultRepoRuntimeInput,
    });

    expect(catalog.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "build",
          label: "build",
          color: "#123456",
        }),
      ]),
    );

    const planProfile = catalog.profiles?.find((entry) => entry.id === "plan");
    expect(planProfile).toBeDefined();
    expect(planProfile).not.toHaveProperty("color");
  });

  test("listAvailableModels ignores malformed or blank agent entries", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        null,
        42,
        {
          name: "   ",
          mode: "primary",
          native: true,
        },
        {
          name: "valid",
          mode: "primary",
          native: false,
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const catalog = await adapter.listAvailableModels({
      ...defaultRepoRuntimeInput,
    });

    expect(catalog.profiles).toEqual([
      expect.objectContaining({
        id: "valid",
        label: "valid",
        mode: "primary",
        native: false,
      }),
    ]);
  });

  test("listAvailableModels preserves agent names exactly as reported by opencode", async () => {
    const mock = makeMockClient({
      agentsResponse: [
        {
          name: "Hephaestus (Deep Agent)",
          description: "Deep agent",
          mode: "primary",
          hidden: false,
          native: false,
        },
      ],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const catalog = await adapter.listAvailableModels({
      ...defaultRepoRuntimeInput,
    });

    expect(catalog.profiles).toEqual([
      expect.objectContaining({
        id: "Hephaestus (Deep Agent)",
        label: "Hephaestus (Deep Agent)",
        mode: "primary",
      }),
    ]);
  });

  test("listAvailableModels rejects profile lookup failures instead of masking them", async () => {
    const mock = makeMockClient({
      agentsResult: {
        mode: "api_error",
        error: {
          message: "agent index unavailable",
        },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await expect(
      adapter.listAvailableModels({
        repoPath: "/repo",
        runtimeKind: "opencode",
      }),
    ).rejects.toThrow("agent index unavailable");
  });

  test("listAvailableToolIds returns normalized tool IDs", async () => {
    const mock = makeMockClient({
      toolIdsResponse: ["odt_read_task", " invalid ", "", " odt_set_spec "],
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const tools = await adapter.listAvailableToolIds({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
    });

    expect(mock.tool.idsCalls).toEqual([{ directory: "/repo" }]);
    expect(tools).toEqual(["odt_read_task", "odt_set_spec"]);
  });

  test("getMcpStatus returns normalized server status map", async () => {
    const mock = makeMockClient({
      mcpStatusResponse: {
        openducktor: { status: "connected" },
        vibe_kanban: { status: "failed", error: "Connection closed" },
      },
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const status = await adapter.getMcpStatus({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
    });

    expect(mock.mcp.statusCalls).toEqual([{ directory: "/repo" }]);
    expect(status).toEqual({
      openducktor: { status: "connected" },
      vibe_kanban: { status: "failed", error: "Connection closed" },
    });
  });

  test("getMcpStatus rejects malformed payloads instead of returning an empty map", async () => {
    const mock = makeMockClient({
      mcpStatusResponse: "not-an-object",
    });
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await expect(
      adapter.getMcpStatus({
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      }),
    ).rejects.toThrow("Invalid MCP status payload");
  });

  test("connectMcpServer forwards server name and directory", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    await adapter.connectMcpServer({
      runtimeEndpoint: "http://127.0.0.1:12345",
      workingDirectory: "/repo",
      name: "openducktor",
    });

    expect(mock.mcp.connectCalls).toEqual([{ directory: "/repo", name: "openducktor" }]);
  });
});
