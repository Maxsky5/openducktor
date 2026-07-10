import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentFileSearchResult,
  AgentModelCatalog,
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

const fileSearchResultsFixture: AgentFileSearchResult[] = [
  {
    id: "src/main.ts",
    path: "src/main.ts",
    name: "main.ts",
    kind: "code",
  },
];

const createAdapter = (overrides: Partial<AgentCatalogPort> = {}): AgentCatalogPort => ({
  listAvailableModels: async () => catalogFixture,
  listAvailableSlashCommands: async () => slashCommandCatalogFixture,
  listAvailableSkills: async () => skillCatalogFixture,
  listAvailableSubagents: async () => subagentCatalogFixture,
  searchFiles: async () => fileSearchResultsFixture,
  ...overrides,
});

const createOperations = (adapter: AgentCatalogPort) =>
  createHostRuntimeCatalogOperations((runtimeKind) => {
    if (runtimeKind !== "opencode") {
      throw new Error(`Unsupported agent runtime '${runtimeKind}'.`);
    }
    return adapter;
  });

describe("runtime-catalog", () => {
  test("loads repo model catalog from runtime coordinates", async () => {
    const listAvailableModels = mock(async () => catalogFixture);
    const operations = createOperations(
      createAdapter({
        listAvailableModels,
      }),
    );

    await expect(
      operations.loadRepoRuntimeCatalog({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
      }),
    ).resolves.toEqual(catalogFixture);
    expect(listAvailableModels).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
    });
  });

  test("propagates adapter runtime resolution failures", async () => {
    const listAvailableModels = mock(async () => {
      throw new Error("No live repo runtime found for repo '/tmp/repo' and runtime 'opencode'.");
    });
    const operations = createOperations(
      createAdapter({
        listAvailableModels,
      }),
    );

    await expect(
      operations.loadRepoRuntimeCatalog({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
      }),
    ).rejects.toThrow("No live repo runtime found for repo '/tmp/repo' and runtime 'opencode'.");
    expect(listAvailableModels).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
    });
  });

  test("loads slash commands from runtime coordinates", async () => {
    const listAvailableSlashCommands = mock(async () => slashCommandCatalogFixture);
    const operations = createOperations(
      createAdapter({
        listAvailableSlashCommands,
      }),
    );

    await expect(
      operations.loadRepoRuntimeSlashCommands({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ).resolves.toEqual(slashCommandCatalogFixture);
    expect(listAvailableSlashCommands).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("loads skills from runtime working-directory coordinates", async () => {
    const listAvailableSkills = mock(async () => skillCatalogFixture);
    const operations = createOperations(
      createAdapter({
        listAvailableSkills,
      }),
    );

    await expect(
      operations.loadRepoRuntimeSkills({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ).resolves.toEqual(skillCatalogFixture);
    expect(listAvailableSkills).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("loads subagents from runtime working-directory coordinates", async () => {
    const listAvailableSubagents = mock(async () => subagentCatalogFixture);
    const operations = createOperations(
      createAdapter({
        listAvailableSubagents,
      }),
    );

    await expect(
      operations.loadRepoRuntimeSubagents({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      }),
    ).resolves.toEqual(subagentCatalogFixture);
    expect(listAvailableSubagents).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("loads repo file search from runtime working-directory coordinates", async () => {
    const searchFiles = mock(async () => fileSearchResultsFixture);
    const operations = createOperations(
      createAdapter({
        searchFiles,
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
    expect(searchFiles).toHaveBeenCalledWith({
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
      const operations = createOperations(createAdapter());
      const result = await operations.checkRepoRuntimeHealth("/tmp/repo", "opencode");

      expect(repoRuntimeHealthStatus).toHaveBeenCalledWith("/tmp/repo", "opencode");
      expect(result).toEqual(healthyRepoRuntimeHealthFixture);
    } finally {
      host.repoRuntimeHealthStatus = originalRepoRuntimeHealthStatus;
    }
  });
});
