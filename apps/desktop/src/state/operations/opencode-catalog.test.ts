import { describe, expect, mock, test } from "bun:test";
import type { AgentModelCatalog } from "@openducktor/core";
import { createOpencodeCatalogOperations } from "./opencode-catalog";

type CatalogDependencies = Parameters<typeof createOpencodeCatalogOperations>[0];
type RuntimeSummary = Awaited<ReturnType<CatalogDependencies["ensureRuntime"]>>;

const runtimeFixture: RuntimeSummary = {
  runtimeId: "runtime-1",
  repoPath: "/tmp/repo",
  taskId: "task-1",
  role: "build",
  workingDirectory: "/tmp/repo/worktree",
  port: 4444,
  startedAt: "2026-02-22T08:00:00.000Z",
};

const catalogFixture: AgentModelCatalog = {
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default"],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  agents: [{ name: "build", mode: "primary" }],
};

const createDeps = (overrides: Partial<CatalogDependencies> = {}): CatalogDependencies => ({
  ensureRuntime: async () => runtimeFixture,
  stopRuntime: async () => ({ ok: true }),
  listAvailableModels: async () => catalogFixture,
  listAvailableToolIds: async () => ["odt_read_task"],
  getMcpStatus: async () => ({
    openducktor: {
      status: "connected",
      command: null,
      args: null,
      env: null,
    },
  }),
  connectMcpServer: async () => {},
  ...overrides,
});

describe("opencode-catalog", () => {
  test("loads repo model catalog from runtime coordinates", async () => {
    const ensureRuntime = mock(async () => runtimeFixture);
    const listAvailableModels = mock(async () => catalogFixture);
    const operations = createOpencodeCatalogOperations(
      createDeps({
        ensureRuntime,
        listAvailableModels,
      }),
    );

    await expect(operations.loadRepoOpencodeCatalog("/tmp/repo")).resolves.toEqual(catalogFixture);
    expect(ensureRuntime).toHaveBeenCalledWith("/tmp/repo");
    expect(listAvailableModels).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("returns runtime-unavailable health when runtime bootstrap fails", async () => {
    const getMcpStatus = mock(async () => ({
      openducktor: {
        status: "connected",
        command: null,
        args: null,
        env: null,
      },
    }));
    const operations = createOpencodeCatalogOperations(
      createDeps({
        ensureRuntime: async () => {
          throw new Error("runtime unavailable");
        },
        getMcpStatus,
      }),
    );

    const result = await operations.checkRepoOpencodeHealth("/tmp/repo");
    expect(result.runtimeOk).toBe(false);
    expect(result.mcpOk).toBe(false);
    expect(result.availableToolIds).toEqual([]);
    expect(result.runtimeError).toContain("runtime unavailable");
    expect(result.mcpError).toContain("MCP cannot be verified");
    expect(result.mcpServerName).toBe("openducktor");
    expect(result.errors).toEqual([
      "runtime unavailable",
      "OpenCode runtime is unavailable, so MCP cannot be verified.",
    ]);
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
    expect(getMcpStatus).not.toHaveBeenCalled();
  });

  test("is healthy when openducktor mcp is connected", async () => {
    const connectMcpServer = mock(async () => {});
    const operations = createOpencodeCatalogOperations(
      createDeps({
        connectMcpServer,
      }),
    );

    const result = await operations.checkRepoOpencodeHealth("/tmp/repo");

    expect(result.runtimeOk).toBe(true);
    expect(result.mcpOk).toBe(true);
    expect(result.runtime).toEqual(runtimeFixture);
    expect(result.mcpError).toBeNull();
    expect(result.mcpServerStatus).toBe("connected");
    expect(result.errors).toEqual([]);
    expect(connectMcpServer).not.toHaveBeenCalled();
  });

  test("reports MCP status failures when status query throws", async () => {
    const operations = createOpencodeCatalogOperations(
      createDeps({
        getMcpStatus: async () => {
          throw new Error("status unavailable");
        },
      }),
    );

    const result = await operations.checkRepoOpencodeHealth("/tmp/repo");

    expect(result.runtimeOk).toBe(true);
    expect(result.mcpOk).toBe(false);
    expect(result.runtime).toEqual(runtimeFixture);
    expect(result.mcpError).toBe("Failed to query OpenCode MCP status: status unavailable");
    expect(result.errors).toEqual(["Failed to query OpenCode MCP status: status unavailable"]);
  });

  test("reports missing openducktor server in MCP status map", async () => {
    const connectMcpServer = mock(async () => {});
    const operations = createOpencodeCatalogOperations(
      createDeps({
        getMcpStatus: async () => ({
          context7: {
            status: "connected",
          },
        }),
        connectMcpServer,
      }),
    );

    const result = await operations.checkRepoOpencodeHealth("/tmp/repo");

    expect(connectMcpServer).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo/worktree",
      name: "openducktor",
    });
    expect(result.mcpOk).toBe(false);
    expect(result.mcpServerStatus).toBeNull();
    expect(result.mcpError).toBe(
      "MCP server 'openducktor' is not configured for this OpenCode runtime.",
    );
    expect(result.errors).toEqual([
      "MCP server 'openducktor' is not configured for this OpenCode runtime.",
    ]);
  });

  test("restarts runtime and retries MCP status on config-invalid failures", async () => {
    const restartedRuntime: RuntimeSummary = {
      ...runtimeFixture,
      runtimeId: "runtime-2",
      port: 5555,
    };
    const ensureRuntime = mock(async (repoPath: string) => {
      if (repoPath !== "/tmp/repo") {
        throw new Error("unexpected repo path");
      }
      return ensureRuntime.mock.calls.length === 1 ? runtimeFixture : restartedRuntime;
    });
    const stopRuntime = mock(async () => ({ ok: true }));
    const getMcpStatus = mock(async (_input: { baseUrl: string; workingDirectory: string }) => {
      if (getMcpStatus.mock.calls.length === 1) {
        throw new Error("ConfigInvalidError: invalid option loglevel");
      }
      return {
        openducktor: {
          status: "connected",
          command: null,
          args: null,
          env: null,
        },
      };
    });
    const listAvailableToolIds = mock(async () => ["odt_read_task", "odt_set_plan"]);
    const operations = createOpencodeCatalogOperations(
      createDeps({
        ensureRuntime,
        stopRuntime,
        getMcpStatus,
        listAvailableToolIds,
      }),
    );

    const result = await operations.checkRepoOpencodeHealth("/tmp/repo");

    expect(ensureRuntime).toHaveBeenCalledTimes(2);
    expect(stopRuntime).toHaveBeenCalledWith("runtime-1");
    expect(getMcpStatus).toHaveBeenCalledTimes(2);
    expect(getMcpStatus.mock.calls[1]?.[0]).toEqual({
      baseUrl: "http://127.0.0.1:5555",
      workingDirectory: "/tmp/repo/worktree",
    });
    expect(result.runtime).toEqual(restartedRuntime);
    expect(result.mcpOk).toBe(true);
    expect(result.mcpServerStatus).toBe("connected");
    expect(result.errors).toEqual([]);
    expect(result.availableToolIds).toEqual(["odt_read_task", "odt_set_plan"]);
  });

  test("reconnects MCP when disconnected and falls back on tool-id lookup errors", async () => {
    const getMcpStatus = mock(async (_input: { baseUrl: string; workingDirectory: string }) => {
      if (getMcpStatus.mock.calls.length === 1) {
        return {
          openducktor: {
            status: "disconnected",
            error: "not connected",
            command: null,
            args: null,
            env: null,
          },
        };
      }
      return {
        openducktor: {
          status: "connected",
          command: null,
          args: null,
          env: null,
        },
      };
    });
    const connectMcpServer = mock(async () => {});
    const listAvailableToolIds = mock(async () => {
      throw new Error("tool list unavailable");
    });
    const operations = createOpencodeCatalogOperations(
      createDeps({
        getMcpStatus,
        connectMcpServer,
        listAvailableToolIds,
      }),
    );

    const result = await operations.checkRepoOpencodeHealth("/tmp/repo");

    expect(connectMcpServer).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo/worktree",
      name: "openducktor",
    });
    expect(getMcpStatus).toHaveBeenCalledTimes(2);
    expect(result.mcpOk).toBe(true);
    expect(result.mcpServerStatus).toBe("connected");
    expect(result.errors).toEqual([]);
    expect(result.availableToolIds).toEqual([]);
  });
});
