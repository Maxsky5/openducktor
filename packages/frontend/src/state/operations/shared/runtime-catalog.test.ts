import { describe, expect, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoRuntimeHealthCheck,
  type RepoRuntimeStartupStatus,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { createRuntimeCatalogOperations } from "./runtime-catalog";

type CatalogDependencies = Parameters<typeof createRuntimeCatalogOperations>[0];
type RuntimeSummary = RuntimeInstanceSummary;

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
  listAvailableModels: async () => catalogFixture,
  listAvailableSlashCommands: async () => slashCommandCatalogFixture,
  searchFiles: async () => fileSearchResultsFixture,
  ...overrides,
});

describe("runtime-catalog", () => {
  test("loads repo model catalog from runtime coordinates", async () => {
    const listAvailableModels = mock(async () => catalogFixture);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        listAvailableModels,
      }),
    );

    await expect(operations.loadRepoRuntimeCatalog("/tmp/repo", "opencode")).resolves.toEqual(
      catalogFixture,
    );
    expect(listAvailableModels).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
    });
  });

  test("propagates adapter runtime resolution failures", async () => {
    const listAvailableModels = mock(async () => {
      throw new Error("No live repo runtime found for repo '/tmp/repo' and runtime 'opencode'.");
    });
    const operations = createRuntimeCatalogOperations(
      createDeps({
        listAvailableModels,
      }),
    );

    await expect(operations.loadRepoRuntimeCatalog("/tmp/repo", "opencode")).rejects.toThrow(
      "No live repo runtime found for repo '/tmp/repo' and runtime 'opencode'.",
    );
    expect(listAvailableModels).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
    });
  });

  test("loads slash commands from runtime coordinates", async () => {
    const listAvailableSlashCommands = mock(async () => slashCommandCatalogFixture);
    const operations = createRuntimeCatalogOperations(
      createDeps({
        listAvailableSlashCommands,
      }),
    );

    await expect(operations.loadRepoRuntimeSlashCommands("/tmp/repo", "opencode")).resolves.toEqual(
      slashCommandCatalogFixture,
    );
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

  test("delegates repo runtime health to the status-only host command", async () => {
    const repoRuntimeHealthStatus = mock(async () => healthyRepoRuntimeHealthFixture);
    const operations = createRuntimeCatalogOperations(createDeps({ repoRuntimeHealthStatus }));

    const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

    expect(repoRuntimeHealthStatus).toHaveBeenCalledWith("opencode", "/tmp/repo");
    expect(result).toEqual(healthyRepoRuntimeHealthFixture);
  });
});
