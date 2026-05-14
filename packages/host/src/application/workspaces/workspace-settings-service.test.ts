import type { GlobalConfig, RepoConfig } from "@openducktor/contracts";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { createWorkspaceSettingsService } from "./workspace-settings-service";

type FakeSettingsConfigPort = SettingsConfigPort & {
  writtenConfigs: GlobalConfig[];
};

const repoConfig = (workspaceId: string, repoPath: string): RepoConfig => ({
  workspaceId,
  workspaceName: workspaceId,
  repoPath,
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
});

const globalConfig = (overrides: Partial<GlobalConfig> = {}): GlobalConfig => ({
  version: 2,
  theme: "light",
  git: { defaultMergeMethod: "merge_commit" },
  general: { openAgentStudioTabOnBackgroundSessionStart: true },
  chat: { showThinkingMessages: false },
  reusablePrompts: [],
  kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show" },
  autopilot: {
    rules: [
      { eventId: "taskProgressedToSpecReady", actionIds: [] },
      { eventId: "taskProgressedToReadyForDev", actionIds: [] },
      { eventId: "taskProgressedToAiReview", actionIds: [] },
      { eventId: "taskRejectedByQa", actionIds: [] },
      { eventId: "taskProgressedToHumanReview", actionIds: [] },
    ],
  },
  agentRuntimes: {
    opencode: { enabled: true },
    codex: { enabled: false },
  },
  workspaces: {},
  workspaceOrder: [],
  recentWorkspaces: [],
  globalPromptOverrides: {},
  ...overrides,
});

const createFakeSettingsConfig = ({
  config = null,
  existingPaths = new Set<string>(),
  canonicalPaths = {},
}: {
  config?: unknown | null;
  existingPaths?: Set<string>;
  canonicalPaths?: Record<string, string>;
} = {}): FakeSettingsConfigPort => {
  const writtenConfigs: GlobalConfig[] = [];
  let currentConfig = config;

  return {
    writtenConfigs,
    async readConfig() {
      return currentConfig;
    },
    async writeConfig(nextConfig) {
      writtenConfigs.push(nextConfig);
      currentConfig = nextConfig;
    },
    defaultWorktreeBasePath(workspaceId) {
      return `/home/dev/.openducktor/worktrees/${workspaceId}`;
    },
    defaultRepoWorktreeBasePath(repoPath) {
      return `/home/dev/.openducktor/worktrees/${repoPath.split("/").at(-1) ?? "repo"}`;
    },
    resolveConfiguredPath(rawPath) {
      return rawPath === "~/worktrees" ? "/home/dev/worktrees" : rawPath.trim();
    },
    async canonicalizePath(rawPath) {
      return canonicalPaths[rawPath] ?? rawPath;
    },
    async pathExists(path) {
      return existingPaths.has(path);
    },
    join(...paths) {
      return paths.join("/").replaceAll(/\/+/g, "/");
    },
  };
};

describe("createWorkspaceSettingsService", () => {
  test("returns default settings snapshot when config is missing", async () => {
    const service = createWorkspaceSettingsService(createFakeSettingsConfig());

    const snapshot = await service.getSettingsSnapshot();

    expect(snapshot.theme).toBe("light");
    expect(snapshot.agentRuntimes?.opencode?.enabled).toBe(true);
    expect(snapshot.agentRuntimes?.codex?.enabled).toBe(false);
    expect(snapshot.workspaces).toEqual({});
  });

  test("lists workspaces in effective order with worktree paths", async () => {
    const service = createWorkspaceSettingsService(
      createFakeSettingsConfig({
        config: globalConfig({
          activeWorkspace: "repo-b",
          workspaceOrder: ["repo-b"],
          workspaces: {
            "repo-a": repoConfig("repo-a", "/repos/a"),
            "repo-b": {
              ...repoConfig("repo-b", "/repos/b"),
              worktreeBasePath: "~/worktrees",
            },
          },
        }),
      }),
    );

    const records = await service.listWorkspaces();

    expect(records.map((record) => record.workspaceId)).toEqual(["repo-b", "repo-a"]);
    expect(records[0]).toMatchObject({
      workspaceId: "repo-b",
      isActive: true,
      configuredWorktreeBasePath: "~/worktrees",
      defaultWorktreeBasePath: "/home/dev/.openducktor/worktrees/repo-b",
      effectiveWorktreeBasePath: "/home/dev/worktrees",
    });
    expect(records[1]?.effectiveWorktreeBasePath).toBe("/home/dev/.openducktor/worktrees/repo-a");
  });

  test("adds, selects, and reorders configured workspaces", async () => {
    const settingsConfig = createFakeSettingsConfig({
      config: globalConfig({
        workspaces: {
          "repo-a": repoConfig("repo-a", "/repos/a"),
        },
        workspaceOrder: ["repo-a"],
      }),
      existingPaths: new Set(["/repos/b", "/repos/b/.git"]),
      canonicalPaths: {
        "/repos/b": "/canonical/b",
      },
    });
    const service = createWorkspaceSettingsService(settingsConfig);

    const added = await service.addWorkspace({
      workspaceId: "repo-b",
      workspaceName: "Repo B",
      repoPath: "/repos/b",
    });
    const selected = await service.selectWorkspace("repo-a");
    const reordered = await service.reorderWorkspaces(["repo-b", "repo-a"]);

    expect(added).toMatchObject({
      workspaceId: "repo-b",
      repoPath: "/canonical/b",
      isActive: true,
    });
    expect(selected).toMatchObject({
      workspaceId: "repo-a",
      isActive: true,
    });
    expect(reordered.map((workspace) => workspace.workspaceId)).toEqual(["repo-b", "repo-a"]);
    expect(settingsConfig.writtenConfigs.at(-1)).toMatchObject({
      activeWorkspace: "repo-a",
      workspaceOrder: ["repo-b", "repo-a"],
      recentWorkspaces: ["repo-a", "repo-b"],
    });
  });

  test("rejects duplicate workspace repo paths", async () => {
    const service = createWorkspaceSettingsService(
      createFakeSettingsConfig({
        config: globalConfig({
          workspaces: {
            "repo-a": repoConfig("repo-a", "/repos/a"),
          },
        }),
        existingPaths: new Set(["/repos/b", "/repos/b/.git"]),
        canonicalPaths: {
          "/repos/b": "/repos/a",
        },
      }),
    );

    await expect(
      service.addWorkspace({
        workspaceId: "repo-b",
        workspaceName: "Repo B",
        repoPath: "/repos/b",
      }),
    ).rejects.toThrow("Repository path is already registered to workspace repo-a: /repos/a");
  });

  test("updates repo config and saves repo settings", async () => {
    const settingsConfig = createFakeSettingsConfig({
      config: globalConfig({
        activeWorkspace: "repo",
        workspaces: {
          repo: {
            ...repoConfig("repo", "/repos/repo"),
            hooks: { preStart: ["bun test"], postComplete: [] },
            worktreeBasePath: "/old-worktrees",
          },
        },
        workspaceOrder: ["repo"],
      }),
      existingPaths: new Set(["/repos/repo", "/repos/repo/.git"]),
    });
    const service = createWorkspaceSettingsService(settingsConfig);

    const updated = await service.updateRepoConfig("repo", {
      branchPrefix: " feature ",
      worktreeCopyPaths: [" .env ", "  "],
    });
    const saved = await service.saveRepoSettings("repo", {
      worktreeBasePath: "   ",
      hooks: { preStart: [" bun lint ", ""], postComplete: [" bun test "] },
    });
    const repo = await service.getRepoConfig("repo");

    expect(updated).toMatchObject({ workspaceId: "repo" });
    expect(saved).toMatchObject({ workspaceId: "repo" });
    expect(repo.branchPrefix).toBe("feature");
    expect(repo.worktreeBasePath).toBeUndefined();
    expect(repo.worktreeCopyPaths).toEqual([".env"]);
    expect(repo.hooks).toEqual({
      preStart: ["bun lint"],
      postComplete: ["bun test"],
    });
  });

  test("loads repo config by canonical repository path", async () => {
    const service = createWorkspaceSettingsService(
      createFakeSettingsConfig({
        config: globalConfig({
          workspaces: {
            repo: repoConfig("repo", "/canonical/repo"),
          },
        }),
        canonicalPaths: {
          "/repo": "/canonical/repo",
        },
      }),
    );

    await expect(service.getRepoConfigByRepoPath("/repo")).resolves.toMatchObject({
      workspaceId: "repo",
      repoPath: "/canonical/repo",
    });
    await expect(service.getRepoConfigByRepoPath("/other")).rejects.toThrow(
      "Workspace is not configured for repository: /other",
    );
  });

  test("reorders only when the order exactly matches configured workspaces", async () => {
    const service = createWorkspaceSettingsService(
      createFakeSettingsConfig({
        config: globalConfig({
          workspaces: {
            "repo-a": repoConfig("repo-a", "/repos/a"),
            "repo-b": repoConfig("repo-b", "/repos/b"),
          },
        }),
      }),
    );

    await expect(service.reorderWorkspaces(["repo-a"])).rejects.toThrow(
      "Workspace reorder must include exactly 2 configured workspaces.",
    );
    await expect(service.reorderWorkspaces(["repo-a", "repo-a"])).rejects.toThrow(
      "Workspace reorder included duplicate workspace id: repo-a",
    );
  });

  test("saves settings snapshots and preserves durable workspace metadata", async () => {
    const settingsConfig = createFakeSettingsConfig({
      config: globalConfig({
        activeWorkspace: "repo",
        workspaceOrder: ["repo"],
        workspaces: {
          repo: repoConfig("repo", "/repos/repo"),
        },
      }),
      existingPaths: new Set(["/repos/repo", "/repos/repo/.git"]),
      canonicalPaths: {
        "/repos/repo": "/canonical/repo",
      },
    });
    const service = createWorkspaceSettingsService(settingsConfig);
    const snapshot = await service.getSettingsSnapshot();
    const repoSnapshot = snapshot.workspaces.repo;
    if (!repoSnapshot) {
      throw new Error("expected repo workspace snapshot");
    }

    const records = await service.saveSettingsSnapshot({
      ...snapshot,
      theme: "dark",
      agentRuntimes: {
        ...snapshot.agentRuntimes,
        codex: { enabled: true },
      },
      workspaces: {
        repo: {
          ...repoSnapshot,
          repoPath: "/repos/repo",
        },
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.repoPath).toBe("/canonical/repo");
    expect(settingsConfig.writtenConfigs[0]).toMatchObject({
      version: 2,
      activeWorkspace: "repo",
      theme: "dark",
      workspaceOrder: ["repo"],
      workspaces: {
        repo: {
          repoPath: "/canonical/repo",
        },
      },
    });
    expect(settingsConfig.writtenConfigs[0]?.agentRuntimes?.codex?.enabled).toBe(true);
  });

  test("rejects unknown snapshot workspaces", async () => {
    const service = createWorkspaceSettingsService(
      createFakeSettingsConfig({
        config: globalConfig(),
      }),
    );
    const snapshot = await service.getSettingsSnapshot();

    await expect(
      service.saveSettingsSnapshot({
        ...snapshot,
        workspaces: {
          repo: repoConfig("repo", "/repos/repo"),
        },
      }),
    ).rejects.toThrow(
      "Workspace not found in config: repo. Add/select the workspace before updating configuration.",
    );
  });

  test("rejects snapshot repo paths that are not git repositories", async () => {
    const service = createWorkspaceSettingsService(
      createFakeSettingsConfig({
        config: globalConfig({
          workspaces: {
            repo: repoConfig("repo", "/repos/repo"),
          },
        }),
        existingPaths: new Set(["/repos/repo"]),
      }),
    );
    const snapshot = await service.getSettingsSnapshot();

    await expect(service.saveSettingsSnapshot(snapshot)).rejects.toThrow(
      "Workspace is not a git repository: /repos/repo",
    );
  });
});
