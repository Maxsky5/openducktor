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
  runtimeOk: true,
  runtimeError: null,
  runtimeFailureKind: null,
  runtime: runtimeFixture,
  mcpOk: true,
  mcpError: null,
  mcpFailureKind: null,
  mcpServerName: "openducktor",
  mcpServerStatus: "connected",
  mcpServerError: null,
  availableToolIds: ["odt_read_task"],
  checkedAt: "2026-02-22T08:00:10.000Z",
  errors: [],
  progress: {
    stage: "ready",
    observation: "observed_existing_runtime",
    startedAt: runtimeFixture.startedAt,
    updatedAt: "2026-02-22T08:00:10.000Z",
    elapsedMs: 5000,
    attempts: 4,
    detail: null,
    failureKind: null,
    failureReason: null,
    failureOrigin: null,
    host: {
      ...startupStatusFixture,
      stage: "runtime_ready",
      runtime: runtimeFixture,
    },
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
  repoRuntimeHealth: async () => healthyRepoRuntimeHealthFixture,
  repoRuntimeHealthStatus: async () => ({
    ...healthyRepoRuntimeHealthFixture,
    runtimeOk: false,
    runtimeError: "OpenCode runtime is starting",
    runtimeFailureKind: "timeout",
    runtime: null,
    mcpOk: false,
    mcpError: "Runtime is unavailable, so MCP cannot be verified.",
    mcpFailureKind: "timeout",
    mcpServerStatus: null,
    mcpServerError: "Runtime is unavailable, so MCP cannot be verified.",
    availableToolIds: [],
    errors: ["OpenCode runtime is starting"],
    progress: {
      stage: "waiting_for_runtime",
      observation: "observing_existing_startup",
      startedAt: startupStatusFixture.startedAt,
      updatedAt: startupStatusFixture.updatedAt,
      elapsedMs: startupStatusFixture.elapsedMs,
      attempts: startupStatusFixture.attempts,
      detail: startupStatusFixture.detail,
      failureKind: null,
      failureReason: null,
      failureOrigin: null,
      host: startupStatusFixture,
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
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo/worktree",
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
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo/worktree",
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
      runtimeKind: "opencode",
      runtimeEndpoint: "http://127.0.0.1:4444",
      workingDirectory: "/tmp/repo/worktree",
      query: "src",
    });
  });

  test("delegates repo runtime health to the host-owned command", async () => {
    const repoRuntimeHealth = mock(async () => healthyRepoRuntimeHealthFixture);
    const operations = createRuntimeCatalogOperations(createDeps({ repoRuntimeHealth }));

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(repoRuntimeHealth).toHaveBeenCalledWith("opencode", "/tmp/repo");
    expect(result).toEqual({
      ...healthyRepoRuntimeHealthFixture,
      progress: healthyRepoRuntimeHealthFixture.progress ?? null,
    });
  });

  test("preserves host startup stage when the frontend times out waiting on the host health command", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        runtimeHealthTimeoutMs: 5,
        repoRuntimeHealth: async () => await new Promise<RepoRuntimeHealthCheck>(() => {}),
        repoRuntimeHealthStatus: async () => ({
          ...healthyRepoRuntimeHealthFixture,
          runtimeOk: false,
          runtimeError: "OpenCode runtime is starting",
          runtimeFailureKind: "timeout",
          runtime: null,
          mcpOk: false,
          mcpError: "Runtime is unavailable, so MCP cannot be verified.",
          mcpFailureKind: "timeout",
          mcpServerStatus: null,
          mcpServerError: "Runtime is unavailable, so MCP cannot be verified.",
          availableToolIds: [],
          errors: ["OpenCode runtime is starting"],
          progress: {
            stage: "checking_mcp_status",
            observation: "observing_existing_startup",
            startedAt: startupStatusFixture.startedAt,
            updatedAt: startupStatusFixture.updatedAt,
            elapsedMs: startupStatusFixture.elapsedMs,
            attempts: startupStatusFixture.attempts,
            detail: "Checking OpenDucktor MCP",
            failureKind: null,
            failureReason: null,
            failureOrigin: null,
            host: {
              ...startupStatusFixture,
              stage: "runtime_ready",
              runtime: runtimeFixture,
            },
          },
        }),
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.runtimeFailureKind).toBe("timeout");
    expect(result.progress).toEqual(
      expect.objectContaining({
        stage: "checking_mcp_status",
        failureOrigin: "frontend_observation",
        attempts: 4,
        elapsedMs: 5000,
      }),
    );
  });

  test("keeps frontend observation timeout distinct from host timeout-shaped failures", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        repoRuntimeHealth: async () => ({
          ...healthyRepoRuntimeHealthFixture,
          mcpOk: false,
          mcpError: "OpenCode runtime failed to load MCP status: HTTP 504",
          mcpFailureKind: "timeout",
          mcpServerStatus: null,
          mcpServerError: "OpenCode runtime failed to load MCP status: HTTP 504",
          errors: ["OpenCode runtime failed to load MCP status: HTTP 504"],
          progress: {
            ...(healthyRepoRuntimeHealthFixture.progress as NonNullable<
              RepoRuntimeHealthCheck["progress"]
            >),
            stage: "checking_mcp_status",
            detail: "OpenCode runtime failed to load MCP status: HTTP 504",
            failureKind: "timeout",
            failureOrigin: "mcp_status",
          },
        }),
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.mcpFailureKind).toBe("timeout");
    expect(result.progress).toEqual(
      expect.objectContaining({
        stage: "checking_mcp_status",
        failureOrigin: "mcp_status",
      }),
    );
  });

  test("surfaces startup-status read failures instead of swallowing them on frontend timeout", async () => {
    const operations = createRuntimeCatalogOperations(
      createDeps({
        runtimeHealthTimeoutMs: 5,
        repoRuntimeHealth: async () => await new Promise<RepoRuntimeHealthCheck>(() => {}),
        repoRuntimeHealthStatus: async () => {
          throw new Error("health status unavailable");
        },
      }),
    );

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(result.runtimeFailureKind).toBe("timeout");
    expect(result.runtimeError).toContain("health status unavailable");
    expect(result.progress).toEqual(
      expect.objectContaining({
        stage: "frontend_observation_timeout",
        failureOrigin: "health_status",
      }),
    );
  });
});
