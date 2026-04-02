import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RunSummary } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { createRuntimeCatalogOperations } from "./runtime-catalog";

type CatalogDependencies = Parameters<typeof createRuntimeCatalogOperations>[0];
type RuntimeSummary = Awaited<ReturnType<CatalogDependencies["ensureRuntime"]>>;

const runtimeFixture: RuntimeSummary = {
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/tmp/repo",
  taskId: "task-1",
  role: "workspace",
  workingDirectory: "/tmp/repo/worktree",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
};

const catalogFixture: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
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
  profiles: [{ id: "build", label: "build", mode: "primary" }],
};

const slashCommandCatalogFixture: AgentSlashCommandCatalog = {
  commands: [
    {
      id: "review",
      trigger: "review",
      title: "review",
      description: "Review current changes",
      source: "command",
      hints: ["$ARGUMENTS"],
    },
  ],
};

const fileSearchResultsFixture: AgentFileSearchResult[] = [
  {
    id: "src/main.ts",
    path: "src/main.ts",
    name: "main.ts",
    kind: "code",
  },
];

const createDeps = (overrides: Partial<CatalogDependencies> = {}): CatalogDependencies => ({
  getRuntimeDefinition: () => OPENCODE_RUNTIME_DESCRIPTOR,
  ensureRuntime: async () => runtimeFixture,
  listRuntimesForRepo: async () => [],
  stopRuntime: async () => ({ ok: true }),
  listRuns: async () => [],
  listAvailableModels: async () => catalogFixture,
  listAvailableSlashCommands: async () => slashCommandCatalogFixture,
  searchFiles: async () => fileSearchResultsFixture,
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
  shouldRestartRuntimeForMcpStatusError: () => false,
  ...overrides,
});

describe("opencode-catalog", () => {
  test("loads repo model catalog from runtime coordinates", async () => {
    const ensureRuntime = mock(async () => runtimeFixture);
    const listAvailableModels = mock(async () => catalogFixture);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        listAvailableModels,
      }),
    );

    await expect(operations.loadRepoRuntimeCatalog("/tmp/repo", "opencode")).resolves.toEqual(
      catalogFixture,
    );
    expect(ensureRuntime).toHaveBeenCalledWith("opencode", "/tmp/repo");
    expect(listAvailableModels).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("loads repo slash command catalog from runtime coordinates", async () => {
    const ensureRuntime = mock(async () => runtimeFixture);
    const listAvailableSlashCommands = mock(async () => slashCommandCatalogFixture);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        listAvailableSlashCommands,
      }),
    );

    await expect(operations.loadRepoRuntimeSlashCommands("/tmp/repo", "opencode")).resolves.toEqual(
      slashCommandCatalogFixture,
    );
    expect(ensureRuntime).toHaveBeenCalledWith("opencode", "/tmp/repo");
    expect(listAvailableSlashCommands).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("reuses a cached repo runtime for catalog loads before ensuring again", async () => {
    const ensureRuntime = mock(async () => runtimeFixture);
    const listAvailableModels = mock(async () => catalogFixture);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        listRuntimesForRepo: async () => [
          {
            ...runtimeFixture,
            workingDirectory: "/tmp/repo",
          },
        ],
        listAvailableModels,
      }),
    );

    await expect(operations.loadRepoRuntimeCatalog("/tmp/repo", "opencode")).resolves.toEqual(
      catalogFixture,
    );
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(listAvailableModels).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo",
    });
  });

  test("loads repo file search results from runtime coordinates", async () => {
    const ensureRuntime = mock(async () => runtimeFixture);
    const searchFiles = mock(async () => fileSearchResultsFixture);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        searchFiles,
      }),
    );

    await expect(
      operations.loadRepoRuntimeFileSearch("/tmp/repo", "opencode", "src/ma"),
    ).resolves.toEqual(fileSearchResultsFixture);
    expect(ensureRuntime).toHaveBeenCalledWith("opencode", "/tmp/repo");
    expect(searchFiles).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo/worktree",
      query: "src/ma",
    });
  });

  test("reuses a cached repo runtime for file search before ensuring again", async () => {
    const ensureRuntime = mock(async () => runtimeFixture);
    const searchFiles = mock(async () => fileSearchResultsFixture);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        listRuntimesForRepo: async () => [
          {
            ...runtimeFixture,
            workingDirectory: "/tmp/repo",
          },
        ],
        searchFiles,
      }),
    );

    await expect(
      operations.loadRepoRuntimeFileSearch("/tmp/repo", "opencode", "src"),
    ).resolves.toEqual(fileSearchResultsFixture);
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(searchFiles).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo",
      query: "src",
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
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime: async () => {
          throw new Error("runtime unavailable");
        },
        getMcpStatus,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");
    expect(result.runtimeOk).toBe(false);
    expect(result.mcpOk).toBe(false);
    expect(result.availableToolIds).toEqual([]);
    expect(result.runtimeError).toContain("runtime unavailable");
    expect(result.runtimeFailureKind).toBe("error");
    expect(result.mcpError).toContain("MCP cannot be verified");
    expect(result.mcpFailureKind).toBe("error");
    expect(result.mcpServerName).toBe("openducktor");
    expect(result.errors).toEqual([
      "runtime unavailable",
      "Runtime is unavailable, so MCP cannot be verified.",
    ]);
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
    expect(getMcpStatus).not.toHaveBeenCalled();
  });

  test("is healthy when openducktor mcp is connected", async () => {
    const connectMcpServer = mock(async () => {});
    const operations = createRuntimeCatalogOperations(
      createDeps({
        connectMcpServer,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.runtimeOk).toBe(true);
    expect(result.mcpOk).toBe(true);
    expect(result.runtime).toEqual(runtimeFixture);
    expect(result.mcpError).toBeNull();
    expect(result.mcpServerStatus).toBe("connected");
    expect(result.errors).toEqual([]);
    expect(connectMcpServer).not.toHaveBeenCalled();
  });

  test("reuses a cached repo runtime for health checks before ensuring again", async () => {
    const ensureRuntime = mock(async () => runtimeFixture);
    const getMcpStatus = mock(async () => ({
      openducktor: {
        status: "connected",
        command: null,
        args: null,
        env: null,
      },
    }));
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        listRuntimesForRepo: async () => [
          {
            ...runtimeFixture,
            workingDirectory: "/tmp/repo",
          },
        ],
        getMcpStatus,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.runtimeOk).toBe(true);
    expect(result.runtime?.workingDirectory).toBe("/tmp/repo");
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(getMcpStatus).toHaveBeenCalledTimes(1);
  });

  test("reports MCP status failures when status query throws", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        getMcpStatus: async () => {
          throw new Error("status unavailable");
        },
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.runtimeOk).toBe(true);
    expect(result.mcpOk).toBe(false);
    expect(result.runtime).toEqual(runtimeFixture);
    expect(result.mcpError).toBe("Failed to query runtime MCP status: status unavailable");
    expect(result.runtimeFailureKind).toBeNull();
    expect(result.mcpFailureKind).toBe("error");
    expect(result.errors).toEqual(["Failed to query runtime MCP status: status unavailable"]);
  });

  test("classifies timeout-shaped runtime and MCP failures distinctly", async () => {
    const runtimeTimeoutOperations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime: async () => {
          throw new Error("Timed out waiting for OpenCode runtime startup readiness");
        },
      }),
    );
    const runtimeTimeoutResult = await runtimeTimeoutOperations.checkRepoRuntimeHealth(
      "/tmp/repo",
      "opencode",
    );

    expect(runtimeTimeoutResult.runtimeFailureKind).toBe("timeout");
    expect(runtimeTimeoutResult.mcpFailureKind).toBe("timeout");

    const mcpTimeoutOperations = createRuntimeCatalogOperations(
      createDeps({
        getMcpStatus: async () => {
          throw new Error("OpenCode startup probe failed reason=timeout after 15000ms");
        },
      }),
    );
    const mcpTimeoutResult = await mcpTimeoutOperations.checkRepoRuntimeHealth(
      "/tmp/repo",
      "opencode",
    );

    expect(mcpTimeoutResult.runtimeFailureKind).toBeNull();
    expect(mcpTimeoutResult.mcpFailureKind).toBe("timeout");
  });

  test("treats MCP status as optional when the runtime does not support it", async () => {
    const getMcpStatus = mock(async () => ({
      openducktor: {
        status: "connected",
      },
    }));
    const operations = createRuntimeCatalogOperations(
      createDeps({
        getRuntimeDefinition: () => ({
          ...OPENCODE_RUNTIME_DESCRIPTOR,
          capabilities: {
            ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
            supportsMcpStatus: false,
          },
        }),
        getMcpStatus,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.runtimeOk).toBe(true);
    expect(result.mcpOk).toBe(true);
    expect(result.availableToolIds).toEqual([]);
    expect(result.mcpServerStatus).toBeNull();
    expect(result.errors).toEqual([]);
    expect(getMcpStatus).not.toHaveBeenCalled();
  });

  test("reconnects MCP when status support reports a disconnected server", async () => {
    const connectMcpServer = mock(async () => {});
    const getMcpStatus = mock(async () => ({
      openducktor: {
        status: "disconnected",
        error: "not connected",
        command: null,
        args: null,
        env: null,
      },
    }));
    const operations = createRuntimeCatalogOperations(
      createDeps({
        getRuntimeDefinition: () => ({
          ...OPENCODE_RUNTIME_DESCRIPTOR,
          capabilities: {
            ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
          },
        }),
        getMcpStatus,
        connectMcpServer,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(connectMcpServer).toHaveBeenCalledTimes(1);
    expect(result.mcpOk).toBe(false);
    expect(result.mcpServerStatus).toBe("disconnected");
    expect(result.mcpError).toBe("not connected");
  });

  test("reports missing openducktor server in MCP status map", async () => {
    const connectMcpServer = mock(async () => {});
    const getMcpStatus = mock(async () => ({
      context7: {
        status: "connected",
      },
    }));
    const operations = createRuntimeCatalogOperations(
      createDeps({
        getMcpStatus,
        connectMcpServer,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(getMcpStatus).toHaveBeenCalledTimes(1);
    expect(connectMcpServer).not.toHaveBeenCalled();
    expect(result.mcpOk).toBe(false);
    expect(result.mcpServerStatus).toBeNull();
    expect(result.mcpError).toBe("MCP server 'openducktor' is not configured for this runtime.");
    expect(result.errors).toEqual(["MCP server 'openducktor' is not configured for this runtime."]);
  });

  test("restarts runtime and retries MCP status on config-invalid failures", async () => {
    const restartedRuntime: RuntimeSummary = {
      ...runtimeFixture,
      runtimeId: "runtime-2",
      runtimeRoute: {
        type: "local_http",
        endpoint: "http://127.0.0.1:5555",
      },
    };
    const ensureRuntime = mock(async (_runtimeKind: string, repoPath: string) => {
      if (repoPath !== "/tmp/repo") {
        throw new Error("unexpected repo path");
      }
      return ensureRuntime.mock.calls.length === 1 ? runtimeFixture : restartedRuntime;
    });
    const stopRuntime = mock(async () => ({ ok: true }));
    const getMcpStatus = mock(
      async (_input: {
        runtimeKind: string;
        runtimeEndpoint: string;
        workingDirectory: string;
      }) => {
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
      },
    );
    const listAvailableToolIds = mock(async () => ["odt_read_task", "odt_set_plan"]);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        stopRuntime,
        getMcpStatus,
        listAvailableToolIds,
        shouldRestartRuntimeForMcpStatusError: () => true,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(ensureRuntime).toHaveBeenCalledTimes(2);
    expect(stopRuntime).toHaveBeenCalledWith("runtime-1");
    expect(getMcpStatus).toHaveBeenCalledTimes(2);
    expect(getMcpStatus.mock.calls[1]?.[0]).toEqual({
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:5555",
      workingDirectory: "/tmp/repo/worktree",
    });
    expect(result.runtime).toEqual(restartedRuntime);
    expect(result.mcpOk).toBe(true);
    expect(result.mcpServerStatus).toBe("connected");
    expect(result.errors).toEqual([]);
    expect(result.availableToolIds).toEqual(["odt_read_task", "odt_set_plan"]);
  });

  test("skips automatic runtime restart when an active run is using the probed runtime", async () => {
    const ensureRuntime = mock(async () => runtimeFixture);
    const stopRuntime = mock(async () => ({ ok: true }));
    const activeRuns: RunSummary[] = [
      {
        runId: "run-1",
        runtimeKind: "opencode",
        runtimeRoute: runtimeFixture.runtimeRoute,
        repoPath: "/tmp/repo",
        taskId: "task-1",
        branch: "odt/task-1",
        worktreePath: "/tmp/repo/worktree",
        port: 4444,
        state: "running",
        lastMessage: null,
        startedAt: "2026-02-22T08:00:00.000Z",
      },
    ];
    const listRuns = mock(async () => activeRuns);
    const getMcpStatus = mock(async () => {
      throw new Error("ConfigInvalidError: invalid option loglevel");
    });
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        stopRuntime,
        listRuns,
        getMcpStatus,
        shouldRestartRuntimeForMcpStatusError: () => true,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(ensureRuntime).toHaveBeenCalledTimes(1);
    expect(listRuns).toHaveBeenCalledWith("/tmp/repo");
    expect(stopRuntime).not.toHaveBeenCalled();
    expect(result.runtime).toEqual(runtimeFixture);
    expect(result.mcpOk).toBe(false);
    expect(result.mcpError).toContain("Automatic runtime restart was skipped");
    expect(result.errors).toEqual([
      "Failed to query runtime MCP status: ConfigInvalidError: invalid option loglevel. Automatic runtime restart was skipped because an active run is using this runtime.",
    ]);
  });

  test("keeps restarted runtime details when config-invalid retry still fails", async () => {
    const restartedRuntime: RuntimeSummary = {
      ...runtimeFixture,
      runtimeId: "runtime-2",
      runtimeRoute: {
        type: "local_http",
        endpoint: "http://127.0.0.1:5555",
      },
    };
    const ensureRuntime = mock(async (_runtimeKind: string, repoPath: string) => {
      if (repoPath !== "/tmp/repo") {
        throw new Error("unexpected repo path");
      }
      return ensureRuntime.mock.calls.length === 1 ? runtimeFixture : restartedRuntime;
    });
    const stopRuntime = mock(async () => ({ ok: true }));
    const getMcpStatus = mock(
      async (_input: {
        runtimeKind: string;
        runtimeEndpoint: string;
        workingDirectory: string;
      }) => {
        if (getMcpStatus.mock.calls.length === 1) {
          throw new Error("ConfigInvalidError: invalid option loglevel");
        }
        throw new Error("status still unavailable");
      },
    );

    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        stopRuntime,
        getMcpStatus,
        shouldRestartRuntimeForMcpStatusError: () => true,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(ensureRuntime).toHaveBeenCalledTimes(2);
    expect(stopRuntime).toHaveBeenCalledWith("runtime-1");
    expect(getMcpStatus).toHaveBeenCalledTimes(2);
    expect(getMcpStatus.mock.calls[1]?.[0]).toEqual({
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:5555",
      workingDirectory: "/tmp/repo/worktree",
    });
    expect(result.runtimeOk).toBe(true);
    expect(result.runtime).toEqual(restartedRuntime);
    expect(result.mcpOk).toBe(false);
    expect(result.mcpError).toBe("Failed to query runtime MCP status: status still unavailable");
    expect(result.errors).toEqual(["Failed to query runtime MCP status: status still unavailable"]);
    expect(result.availableToolIds).toEqual([]);
  });

  test("reconnects MCP when disconnected and falls back on tool-id lookup errors", async () => {
    const getMcpStatus = mock(
      async (_input: {
        runtimeKind: string;
        runtimeEndpoint: string;
        workingDirectory: string;
      }) => {
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
      },
    );
    const connectMcpServer = mock(async () => {});
    const listAvailableToolIds = mock(async () => {
      throw new Error("tool list unavailable");
    });
    const operations = createRuntimeCatalogOperations(
      createDeps({
        getMcpStatus,
        connectMcpServer,
        listAvailableToolIds,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(connectMcpServer).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:4444",
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
