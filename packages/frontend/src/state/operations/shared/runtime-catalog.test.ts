import { describe, expect, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoRuntimeHealthCheck,
  type RepoRuntimeStartupStatus,
} from "@openducktor/contracts";
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
  taskId: null,
  role: "workspace",
  workingDirectory: "/tmp/repo/worktree",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
};

const startupStatusFixture: RepoRuntimeStartupStatus = {
  runtimeKind: "opencode",
  repoPath: "/tmp/repo",
  stage: "waiting_for_runtime",
  runtime: null,
  startedAt: "2026-02-22T08:00:00.000Z",
  updatedAt: "2026-02-22T08:00:05.000Z",
  elapsedMs: 5000,
  attempts: 4,
  failureKind: null,
  failureReason: null,
  detail: null,
};

const healthyRepoRuntimeHealthFixture: RepoRuntimeHealthCheck = {
  status: "ready",
  checkedAt: "2026-02-22T08:00:10.000Z",
  runtime: {
    status: "ready",
    stage: "runtime_ready",
    observation: "observed_existing_runtime",
    instance: runtimeFixture,
    startedAt: runtimeFixture.startedAt,
    updatedAt: "2026-02-22T08:00:10.000Z",
    elapsedMs: 5000,
    attempts: 4,
    detail: null,
    failureKind: null,
    failureReason: null,
  },
  mcp: {
    supported: true,
    status: "connected",
    serverName: "openducktor",
    serverStatus: "connected",
    toolIds: ["odt_read_task"],
    detail: null,
    failureKind: null,
  },
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
  supportsMcpStatus: () => true,
  repoRuntimeHealth: async () => healthyRepoRuntimeHealthFixture,
  repoRuntimeHealthStatus: async () => ({
    ...healthyRepoRuntimeHealthFixture,
    status: "checking",
    runtime: {
      status: "checking",
      stage: "waiting_for_runtime",
      observation: "observing_existing_startup",
      instance: null,
      startedAt: startupStatusFixture.startedAt,
      updatedAt: startupStatusFixture.updatedAt,
      elapsedMs: startupStatusFixture.elapsedMs,
      attempts: startupStatusFixture.attempts,
      detail: startupStatusFixture.detail,
      failureKind: "timeout",
      failureReason: null,
    },
    mcp: {
      supported: true,
      status: "waiting_for_runtime",
      serverName: "openducktor",
      serverStatus: null,
      toolIds: [],
      detail: "Runtime is unavailable, so MCP cannot be verified.",
      failureKind: "timeout",
    },
  }),
  ensureRuntime: async () => runtimeFixture,
  listRuntimesForRepo: async () => [],
  listAvailableModels: async () => catalogFixture,
  listAvailableSlashCommands: async () => slashCommandCatalogFixture,
  searchFiles: async () => fileSearchResultsFixture,
  ...overrides,
});

describe("runtime-catalog", () => {
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
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
    });
  });

  test("reuses a cached repo runtime for slash commands before ensuring again", async () => {
    const ensureRuntime = mock(async () => runtimeFixture);
    const listAvailableSlashCommands = mock(async () => slashCommandCatalogFixture);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        ensureRuntime,
        listAvailableSlashCommands,
        listRuntimesForRepo: async () => [runtimeFixture],
      }),
    );

    await expect(operations.loadRepoRuntimeSlashCommands("/tmp/repo", "opencode")).resolves.toEqual(
      slashCommandCatalogFixture,
    );
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(listAvailableSlashCommands).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
    });
  });

  test("loads repo file search from runtime coordinates", async () => {
    const searchFiles = mock(async () => fileSearchResultsFixture);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        searchFiles,
      }),
    );

    await expect(
      operations.loadRepoRuntimeFileSearch("/tmp/repo", "opencode", "src"),
    ).resolves.toEqual(fileSearchResultsFixture);
    expect(searchFiles).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      query: "src",
    });
  });

  test("delegates repo runtime health to the host-owned command", async () => {
    const repoRuntimeHealth = mock(async () => healthyRepoRuntimeHealthFixture);
    const operations = createRuntimeCatalogOperations(createDeps({ repoRuntimeHealth }));

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(repoRuntimeHealth).toHaveBeenCalledWith("opencode", "/tmp/repo");
    expect(result).toEqual(healthyRepoRuntimeHealthFixture);
  });

  test("preserves host startup stage when the frontend times out waiting on the host health command", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        runtimeHealthTimeoutMs: 5,
        runtimeHealthStatusTimeoutMs: 5,
        repoRuntimeHealth: async () => await new Promise<RepoRuntimeHealthCheck>(() => {}),
        repoRuntimeHealthStatus: async () => ({
          ...healthyRepoRuntimeHealthFixture,
          status: "checking",
          runtime: {
            status: "ready",
            stage: "runtime_ready",
            observation: "observing_existing_startup",
            instance: runtimeFixture,
            startedAt: startupStatusFixture.startedAt,
            updatedAt: startupStatusFixture.updatedAt,
            elapsedMs: startupStatusFixture.elapsedMs,
            attempts: startupStatusFixture.attempts,
            detail: null,
            failureKind: null,
            failureReason: null,
          },
          mcp: {
            supported: true,
            status: "checking",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "Checking OpenDucktor MCP",
            failureKind: null,
          },
        }),
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.status).toBe("checking");
    expect(result.mcp?.status).toBe("checking");
    expect(result.runtime.attempts).toBe(4);
    expect(result.runtime.elapsedMs).toBe(5000);
  });

  test("does not trust a stale ready host snapshot when the foreground health query times out", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        runtimeHealthTimeoutMs: 5,
        runtimeHealthStatusTimeoutMs: 5,
        repoRuntimeHealth: async () => await new Promise<RepoRuntimeHealthCheck>(() => {}),
        repoRuntimeHealthStatus: async () => healthyRepoRuntimeHealthFixture,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.status).toBe("checking");
    expect(result.runtime.status).toBe("ready");
    expect(result.mcp?.status).toBe("checking");
    expect(result.mcp?.detail).toContain("Timed out after 5ms");
    expect(result.mcp?.failureKind).toBe("timeout");
  });

  test("preserves a ready snapshot for runtimes without MCP status support when the foreground health query times out", async () => {
    const readyWithoutMcp: RepoRuntimeHealthCheck = {
      ...healthyRepoRuntimeHealthFixture,
      checkedAt: "2026-02-22T08:00:11.000Z",
      mcp: null,
    };
    const operations = createRuntimeCatalogOperations(
      createDeps({
        supportsMcpStatus: () => false,
        runtimeHealthTimeoutMs: 5,
        runtimeHealthStatusTimeoutMs: 5,
        repoRuntimeHealth: async () => await new Promise<RepoRuntimeHealthCheck>(() => {}),
        repoRuntimeHealthStatus: async () => readyWithoutMcp,
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result).toEqual(readyWithoutMcp);
  });

  test("omits synthetic MCP errors for runtimes without MCP status support when status fallback also times out", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        supportsMcpStatus: () => false,
        runtimeHealthTimeoutMs: 5,
        runtimeHealthStatusTimeoutMs: 5,
        repoRuntimeHealth: async () => await new Promise<RepoRuntimeHealthCheck>(() => {}),
        repoRuntimeHealthStatus: async () => {
          throw new Error("health status unavailable");
        },
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.status).toBe("error");
    expect(result.runtime.detail).toContain("health status unavailable");
    expect(result.mcp).toBeNull();
  });

  test("keeps frontend observation timeout distinct from host timeout-shaped failures", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        repoRuntimeHealth: async () => ({
          ...healthyRepoRuntimeHealthFixture,
          status: "error",
          mcp: {
            supported: true,
            status: "error",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "OpenCode runtime failed to load MCP status: HTTP 504",
            failureKind: "timeout",
          },
        }),
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.status).toBe("error");
    expect(result.mcp?.failureKind).toBe("timeout");
  });

  test("surfaces startup-status read failures instead of swallowing them on frontend timeout", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        runtimeHealthTimeoutMs: 5,
        runtimeHealthStatusTimeoutMs: 5,
        repoRuntimeHealth: async () => await new Promise<RepoRuntimeHealthCheck>(() => {}),
        repoRuntimeHealthStatus: async () => {
          throw new Error("health status unavailable");
        },
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.status).toBe("error");
    expect(result.runtime.detail).toContain("health status unavailable");
  });

  test("times out the fallback host status read too", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        runtimeHealthTimeoutMs: 5,
        runtimeHealthStatusTimeoutMs: 5,
        repoRuntimeHealth: async () => await new Promise<RepoRuntimeHealthCheck>(() => {}),
        repoRuntimeHealthStatus: async () => await new Promise<RepoRuntimeHealthCheck>(() => {}),
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.status).toBe("error");
    expect(result.runtime.detail).toContain("Failed to load latest host runtime health status");
    expect(result.runtime.detail).toContain("Timed out after 5ms");
  });
});
