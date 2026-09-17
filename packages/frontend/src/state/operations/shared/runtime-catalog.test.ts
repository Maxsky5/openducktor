import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentRuntimeCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
} from "@openducktor/core";
import { host } from "./host";
import { createHostRuntimeCatalogOperations } from "./runtime-catalog";

type HostRepoRuntimeHealthCheck = Awaited<ReturnType<typeof host.repoRuntimeHealth>>;

const runtimeFixture: NonNullable<HostRepoRuntimeHealthCheck["runtime"]["instance"]> = {
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

const healthyRepoRuntimeHealthFixture: HostRepoRuntimeHealthCheck = {
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

const skillCatalogFixture: AgentSkillCatalog = {
  skills: [
    {
      id: "review",
      name: "review",
      path: "/repo/.agents/skills/review/SKILL.md",
      title: "Review",
    },
  ],
};

const subagentCatalogFixture: AgentSubagentCatalog = {
  subagents: [
    {
      id: "reviewer",
      name: "reviewer",
      label: "Reviewer",
    },
  ],
};

const runtimeCatalogFixture: AgentRuntimeCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: { status: "available", catalog: catalogFixture },
  slashCommands: { status: "available", catalog: slashCommandCatalogFixture },
  skills: { status: "available", catalog: skillCatalogFixture },
  subagents: { status: "available", catalog: subagentCatalogFixture },
};

const fileSearchResultsFixture: AgentFileSearchResult[] = [
  {
    id: "src/main.ts",
    path: "src/main.ts",
    name: "main.ts",
    kind: "code",
  },
];

type RuntimeCatalogHostClient = Parameters<typeof createHostRuntimeCatalogOperations>[0];

const createHostClient = (
  overrides: Partial<RuntimeCatalogHostClient> = {},
): RuntimeCatalogHostClient => ({
  agentRuntimeLoadCatalog: async () => runtimeCatalogFixture,
  agentRuntimeSearchFiles: async () => fileSearchResultsFixture,
  repoRuntimeHealthStatus: (...args) => host.repoRuntimeHealthStatus(...args),
  ...overrides,
});

const createOperations = (hostClient: RuntimeCatalogHostClient) =>
  createHostRuntimeCatalogOperations(hostClient);

describe("runtime-catalog", () => {
  test("loads the combined runtime catalog from runtime coordinates", async () => {
    const agentRuntimeLoadCatalog = mock(async () => runtimeCatalogFixture);
    const operations = createOperations(
      createHostClient({
        agentRuntimeLoadCatalog,
      }),
    );

    await expect(
      operations.loadRuntimeCatalog({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ).resolves.toEqual(runtimeCatalogFixture);
    expect(agentRuntimeLoadCatalog).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("propagates host catalog failures", async () => {
    const agentRuntimeLoadCatalog = mock(async () => {
      throw new Error("No live repo runtime found for repo '/tmp/repo' and runtime 'opencode'.");
    });
    const operations = createOperations(
      createHostClient({
        agentRuntimeLoadCatalog,
      }),
    );

    await expect(
      operations.loadRuntimeCatalog({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ).rejects.toThrow("No live repo runtime found for repo '/tmp/repo' and runtime 'opencode'.");
  });

  test("loads repo file search from runtime working-directory coordinates", async () => {
    const agentRuntimeSearchFiles = mock(async () => fileSearchResultsFixture);
    const operations = createOperations(
      createHostClient({
        agentRuntimeSearchFiles,
      }),
    );

    await expect(
      operations.loadRepoRuntimeFileSearch(
        {
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        },
        "src",
      ),
    ).resolves.toEqual(fileSearchResultsFixture);
    expect(agentRuntimeSearchFiles).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      query: "src",
    });
  });

  test("delegates repo runtime health to the status-only host command", async () => {
    const repoRuntimeHealthStatus = mock(async () => healthyRepoRuntimeHealthFixture);
    const originalRepoRuntimeHealthStatus = host.repoRuntimeHealthStatus;
    host.repoRuntimeHealthStatus = repoRuntimeHealthStatus;

    try {
      const operations = createOperations(createHostClient());
      const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

      expect(repoRuntimeHealthStatus).toHaveBeenCalledWith("/tmp/repo", "opencode");
      expect(result).toEqual(healthyRepoRuntimeHealthFixture);
    } finally {
      host.repoRuntimeHealthStatus = originalRepoRuntimeHealthStatus;
    }
  });
});
