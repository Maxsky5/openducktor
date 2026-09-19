import { describe, expect, test } from "bun:test";

import type { AgentModelCatalog } from "@openducktor/core";
import { defaultRepoRuntimeInput, makeMockClient, OpencodeSdkAdapter } from "./test-support";

const loadModelsCatalog = async (adapter: OpencodeSdkAdapter): Promise<AgentModelCatalog> => {
  const catalog = await adapter.loadRuntimeCatalog({ ...defaultRepoRuntimeInput });
  if (catalog.models?.status !== "available") {
    throw new Error("Expected the models surface to be available.");
  }
  return catalog.models.catalog;
};

const modelsSurfaceFailure = async (adapter: OpencodeSdkAdapter): Promise<Error> => {
  const catalog = await adapter.loadRuntimeCatalog({ ...defaultRepoRuntimeInput });
  const cause = catalog.models?.status === "failed" ? catalog.models.cause : undefined;
  if (!(cause instanceof Error)) {
    throw new Error("Expected the models surface to fail with an Error cause.");
  }
  return cause;
};

describe("OpencodeSdkAdapter catalog and mcp", () => {
  test("loadRuntimeCatalog returns provider models and primary agents", async () => {
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

    const catalog = await loadModelsCatalog(adapter);

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

  test("loadRuntimeCatalog applies OpenCode default colors for native agents without explicit color", async () => {
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

    const catalog = await loadModelsCatalog(adapter);

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

  test("loadRuntimeCatalog does not synthesize colors for unsupported native names", async () => {
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

    const catalog = await loadModelsCatalog(adapter);

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

  test("loadRuntimeCatalog keeps explicit native color and skips fallback for non-native reserved names", async () => {
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

    const catalog = await loadModelsCatalog(adapter);

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

  test("loadRuntimeCatalog fails the models surface for malformed agent entries", async () => {
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

    await expect(modelsSurfaceFailure(adapter)).resolves.toBeDefined();
  });

  test("loadRuntimeCatalog preserves agent names exactly as reported by opencode", async () => {
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

    const catalog = await loadModelsCatalog(adapter);

    expect(catalog.profiles).toEqual([
      expect.objectContaining({
        id: "Hephaestus (Deep Agent)",
        label: "Hephaestus (Deep Agent)",
        mode: "primary",
      }),
    ]);
  });

  test("loadRuntimeCatalog reports profile lookup failures instead of masking them", async () => {
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

    const cause = await modelsSurfaceFailure(adapter);
    expect(String(cause)).toContain("agent index unavailable");
  });
});
