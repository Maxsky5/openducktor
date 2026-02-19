import { describe, expect, test } from "bun:test";
import { REQUIRED_ODT_TOOL_IDS, createOpencodeCatalogOperations } from "./opencode-catalog";

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
    let listToolsCalled = false;
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async () => {
        throw new Error("runtime boot failed");
      },
      listAvailableModels: async () => catalogFixture,
      listAvailableToolIds: async () => {
        listToolsCalled = true;
        return [];
      },
    });

    const health = await operations.checkRepoOpencodeHealth("/repo");

    expect(listToolsCalled).toBe(false);
    expect(health.runtimeOk).toBe(false);
    expect(health.mcpOk).toBe(false);
    expect(health.runtimeError).toBe("runtime boot failed");
    expect(health.missingRequiredToolIds).toEqual([...REQUIRED_ODT_TOOL_IDS]);
    expect(health.errors).toContain("runtime boot failed");
    expect(Date.parse(health.checkedAt)).not.toBeNaN();
  });

  test("checkRepoOpencodeHealth is healthy when all required odt tools are available", async () => {
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async () => runtimeFixture,
      listAvailableModels: async () => catalogFixture,
      listAvailableToolIds: async () => [...REQUIRED_ODT_TOOL_IDS, "read", "glob"],
    });

    const health = await operations.checkRepoOpencodeHealth("/repo");

    expect(health.runtimeOk).toBe(true);
    expect(health.mcpOk).toBe(true);
    expect(health.runtime).toEqual(runtimeFixture);
    expect(health.mcpError).toBeNull();
    expect(health.missingRequiredToolIds).toEqual([]);
    expect(health.errors).toEqual([]);
  });

  test("checkRepoOpencodeHealth reports missing required odt tools", async () => {
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async () => runtimeFixture,
      listAvailableModels: async () => catalogFixture,
      listAvailableToolIds: async () => ["odt_read_task", "odt_set_spec"],
    });

    const health = await operations.checkRepoOpencodeHealth("/repo");

    expect(health.runtimeOk).toBe(true);
    expect(health.mcpOk).toBe(false);
    expect(health.missingRequiredToolIds).toEqual([
      "odt_set_plan",
      "odt_build_blocked",
      "odt_build_resumed",
      "odt_build_completed",
      "odt_qa_approved",
      "odt_qa_rejected",
    ]);
    expect(health.mcpError).toContain("Missing required OpenDucktor MCP tools");
  });

  test("checkRepoOpencodeHealth reports tool catalog query failures", async () => {
    const operations = createOpencodeCatalogOperations({
      ensureRuntime: async () => runtimeFixture,
      listAvailableModels: async () => catalogFixture,
      listAvailableToolIds: async () => {
        throw new Error("tool ids unavailable");
      },
    });

    const health = await operations.checkRepoOpencodeHealth("/repo");

    expect(health.runtimeOk).toBe(true);
    expect(health.mcpOk).toBe(false);
    expect(health.runtime).toEqual(runtimeFixture);
    expect(health.mcpError).toBe("Failed to query OpenCode tools: tool ids unavailable");
    expect(health.missingRequiredToolIds).toEqual([...REQUIRED_ODT_TOOL_IDS]);
    expect(health.errors).toEqual(["Failed to query OpenCode tools: tool ids unavailable"]);
  });
});
