import { describe, expect, test } from "bun:test";
import { createOpencodeCatalogOperations } from "./opencode-catalog";

const runtimeFixture = {
  runtimeId: "runtime-spec-main",
  repoPath: "/repo",
  taskId: "repo-main",
  role: "spec",
  workingDirectory: "/repo",
  port: 43121,
  startedAt: "2026-02-19T18:00:00.000Z",
};

const catalogFixture = {
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["high", "low"],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  agents: [],
};

describe("createOpencodeCatalogOperations", () => {
  test("loadRepoOpencodeCatalog ensures runtime and loads catalog from runtime endpoint", async () => {
    const runtimeCalls = [];
    const modelCalls = [];
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async (repoPath) => {
        runtimeCalls.push(repoPath);
        return runtimeFixture;
      },
      listAvailableModels: async (input) => {
        modelCalls.push(input);
        return catalogFixture;
      },
      listAvailableToolIds: async () => [],
      getMcpStatus: async () => ({}),
      connectMcpServer: async () => {},
    });

    const catalog = await operations.loadRepoOpencodeCatalog("/repo");

    expect(catalog).toEqual(catalogFixture);
    expect(runtimeCalls).toEqual(["/repo"]);
    expect(modelCalls).toEqual([
      {
        baseUrl: "http://127.0.0.1:43121",
        workingDirectory: "/repo",
      },
    ]);
  });

  test("checkRepoOpencodeHealth returns runtime and MCP failure when runtime bootstrap fails", async () => {
    let mcpStatusCalled = false;
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async () => {
        throw new Error("runtime boot failed");
      },
      listAvailableModels: async () => catalogFixture,
      listAvailableToolIds: async () => [],
      getMcpStatus: async () => {
        mcpStatusCalled = true;
        return {};
      },
      connectMcpServer: async () => {},
    });

    const health = await operations.checkRepoOpencodeHealth("/repo");

    expect(mcpStatusCalled).toBe(false);
    expect(health.runtimeOk).toBe(false);
    expect(health.mcpOk).toBe(false);
    expect(health.runtimeError).toBe("runtime boot failed");
    expect(health.mcpServerName).toBe("openducktor");
    expect(health.errors).toContain("runtime boot failed");
    expect(Date.parse(health.checkedAt)).not.toBeNaN();
  });

  test("checkRepoOpencodeHealth is healthy when openducktor mcp is connected", async () => {
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async () => runtimeFixture,
      listAvailableModels: async () => catalogFixture,
      listAvailableToolIds: async () => ["read", "glob"],
      getMcpStatus: async () => ({
        openducktor: { status: "connected" },
      }),
      connectMcpServer: async () => {},
    });

    const health = await operations.checkRepoOpencodeHealth("/repo");

    expect(health.runtimeOk).toBe(true);
    expect(health.mcpOk).toBe(true);
    expect(health.runtime).toEqual(runtimeFixture);
    expect(health.mcpError).toBeNull();
    expect(health.mcpServerStatus).toBe("connected");
    expect(health.errors).toEqual([]);
  });

  test("checkRepoOpencodeHealth reconnects openducktor mcp when it is failed", async () => {
    const statusCalls = [];
    const connectCalls = [];
    let callCount = 0;
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async () => runtimeFixture,
      listAvailableModels: async () => catalogFixture,
      listAvailableToolIds: async () => [],
      getMcpStatus: async (input) => {
        statusCalls.push(input);
        callCount += 1;
        if (callCount === 1) {
          return {
            openducktor: { status: "failed", error: "Connection closed" },
          };
        }
        return {
          openducktor: { status: "connected" },
        };
      },
      connectMcpServer: async (input) => {
        connectCalls.push(input);
      },
    });

    const health = await operations.checkRepoOpencodeHealth("/repo");

    expect(statusCalls).toHaveLength(2);
    expect(connectCalls).toEqual([
      {
        baseUrl: "http://127.0.0.1:43121",
        workingDirectory: "/repo",
        name: "openducktor",
      },
    ]);
    expect(health.mcpOk).toBe(true);
    expect(health.mcpServerStatus).toBe("connected");
    expect(health.errors).toEqual([]);
  });

  test("checkRepoOpencodeHealth reports MCP status failures", async () => {
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async () => runtimeFixture,
      listAvailableModels: async () => catalogFixture,
      listAvailableToolIds: async () => [],
      getMcpStatus: async () => {
        throw new Error("status unavailable");
      },
      connectMcpServer: async () => {},
    });

    const health = await operations.checkRepoOpencodeHealth("/repo");

    expect(health.runtimeOk).toBe(true);
    expect(health.mcpOk).toBe(false);
    expect(health.runtime).toEqual(runtimeFixture);
    expect(health.mcpError).toBe("Failed to query OpenCode MCP status: status unavailable");
    expect(health.errors).toEqual(["Failed to query OpenCode MCP status: status unavailable"]);
  });

  test("checkRepoOpencodeHealth reports missing openducktor server in status map", async () => {
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async () => runtimeFixture,
      listAvailableModels: async () => catalogFixture,
      listAvailableToolIds: async () => [],
      getMcpStatus: async () => ({
        context7: { status: "connected" },
      }),
      connectMcpServer: async () => {},
    });

    const health = await operations.checkRepoOpencodeHealth("/repo");

    expect(health.mcpOk).toBe(false);
    expect(health.mcpServerStatus).toBeNull();
    expect(health.mcpError).toContain("MCP server 'openducktor' is not configured");
  });
});
