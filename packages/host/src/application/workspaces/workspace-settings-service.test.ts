import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_CODEX_RUNTIME_POLICY,
  type GlobalConfig,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import { HostOperationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { createWorkspaceSettingsService as createEffectWorkspaceSettingsService } from "./workspace-settings-service";

const createWorkspaceSettingsService = (
  ...args: Parameters<typeof createEffectWorkspaceSettingsService>
) => createEffectWorkspaceSettingsService(...args);
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
  version: 3,
  theme: "light",
  git: { defaultMergeMethod: "merge_commit" },
  general: { openAgentStudioTabOnBackgroundSessionStart: true },
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  chat: DEFAULT_CHAT_SETTINGS,
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
    opencode: { enabled: true, executablePath: "/bin/opencode" },
    codex: {
      enabled: false,
      executablePath: "/bin/codex",
      defaults: { ...DEFAULT_CODEX_RUNTIME_POLICY },
      roleOverrides: {},
    },
    claude: { enabled: false, executablePath: "/bin/claude" },
  },
  agentModelFavorites: [],
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
  beforeWrite,
}: {
  config?: GlobalConfig | null;
  existingPaths?: Set<string>;
  canonicalPaths?: Record<string, string>;
  beforeWrite?: (nextConfig: GlobalConfig) => Promise<void>;
} = {}): FakeSettingsConfigPort => {
  const writtenConfigs: GlobalConfig[] = [];
  let currentConfig = config;
  const port: SettingsConfigPort & {
    writtenConfigs: GlobalConfig[];
  } = {
    writtenConfigs,
    readConfig() {
      return Effect.tryPromise({
        try: async () => {
          return currentConfig;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    writeConfig(nextConfig: GlobalConfig) {
      return Effect.tryPromise({
        try: async () => {
          await beforeWrite?.(nextConfig);
          writtenConfigs.push(nextConfig);
          currentConfig = nextConfig;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    defaultWorktreeBasePath(workspaceId: string) {
      return `/home/dev/.openducktor/worktrees/${workspaceId}`;
    },
    defaultRepoWorktreeBasePath(repoPath: string) {
      return `/home/dev/.openducktor/worktrees/${repoPath.split("/").at(-1) ?? "repo"}`;
    },
    resolveConfiguredPath(rawPath: string) {
      return rawPath === "~/worktrees" ? "/home/dev/worktrees" : rawPath.trim();
    },
    canonicalizePath(rawPath: string) {
      return Effect.tryPromise({
        try: async () => {
          return canonicalPaths[rawPath] ?? rawPath;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    pathExists(path: string) {
      return Effect.succeed(existingPaths.has(path));
    },
    join(...paths: string[]) {
      return paths.join("/").replaceAll(/\/+/g, "/");
    },
  };
  return port as unknown as FakeSettingsConfigPort;
};
describe("createWorkspaceSettingsService", () => {
  test("returns default settings snapshot when config is missing", async () => {
    const service = createWorkspaceSettingsService(createFakeSettingsConfig());
    const snapshot = await Effect.runPromise(service.getSettingsSnapshot());
    expect(snapshot.theme).toBe("light");
    expect(snapshot.agentRuntimes?.opencode).toEqual({ enabled: false, executablePath: "" });
    expect(snapshot.agentRuntimes?.codex?.enabled).toBe(false);
    expect(snapshot.agentRuntimes?.codex?.executablePath).toBe("");
    expect(snapshot.agentRuntimes?.codex?.defaults).toEqual(DEFAULT_CODEX_RUNTIME_POLICY);
    expect(snapshot.agentRuntimes?.codex?.roleOverrides).toEqual({});
    expect(snapshot.appearance).toEqual(DEFAULT_APPEARANCE_SETTINGS);
    expect(snapshot.agentModelFavorites).toEqual([]);
    expect(snapshot.workspaces).toEqual({});
  });

  test("updates only canonical agent model favorites", async () => {
    const settingsConfig = createFakeSettingsConfig({
      config: globalConfig({
        theme: "dark",
        recentWorkspaces: ["repo"],
        agentModelFavorites: [
          { runtimeKind: "claude", providerId: "anthropic", modelId: "claude-opus" },
        ],
      }),
    });
    const service = createWorkspaceSettingsService(settingsConfig);

    const snapshot = await Effect.runPromise(
      service.updateAgentModelFavorites([
        { runtimeKind: "opencode", providerId: " openai ", modelId: " gpt-5 " },
        { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
        { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
      ]),
    );

    expect(snapshot.agentModelFavorites).toEqual([
      { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
      { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
    ]);
    expect(settingsConfig.writtenConfigs).toHaveLength(1);
    expect(settingsConfig.writtenConfigs[0]).toMatchObject({
      theme: "dark",
      recentWorkspaces: ["repo"],
      agentModelFavorites: snapshot.agentModelFavorites,
    });
  });
  test("reloads exact agent model favorites through a fresh disk adapter and service", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openducktor-settings-restart-"));
    const configPath = path.join(tempDir, "config.json");
    const favorite = {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-5",
    };

    try {
      const firstService = createWorkspaceSettingsService(
        createSettingsConfigAdapter({ configPath }),
      );
      await Effect.runPromise(firstService.updateAgentModelFavorites([favorite]));

      const restartedService = createWorkspaceSettingsService(
        createSettingsConfigAdapter({ configPath }),
      );
      const restartedSnapshot = await Effect.runPromise(restartedService.getSettingsSnapshot());

      expect(restartedSnapshot.agentModelFavorites).toEqual([favorite]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
  test("normalizes legacy enabled-only Codex runtime settings in snapshots", async () => {
    const service = createWorkspaceSettingsService(
      createFakeSettingsConfig({
        config: globalConfig({
          agentRuntimes: {
            opencode: { enabled: true, executablePath: "/bin/opencode" },
            codex: { enabled: true, executablePath: "/bin/codex" },
          },
        } as unknown as Partial<GlobalConfig>),
      }),
    );

    const snapshot = await Effect.runPromise(service.getSettingsSnapshot());

    expect(snapshot.agentRuntimes.codex).toEqual({
      enabled: true,
      executablePath: "/bin/codex",
      defaults: DEFAULT_CODEX_RUNTIME_POLICY,
      roleOverrides: {},
    });
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
    const records = await Effect.runPromise(service.listWorkspaces());
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
    const added = await Effect.runPromise(
      service.addWorkspace({
        workspaceId: "repo-b",
        workspaceName: "Repo B",
        repoPath: "/repos/b",
        defaultRuntimeKind: "codex",
      }),
    );
    const addedRepoConfig = await Effect.runPromise(service.getRepoConfig("repo-b"));
    const selected = await Effect.runPromise(service.selectWorkspace("repo-a"));
    const reordered = await Effect.runPromise(service.reorderWorkspaces(["repo-b", "repo-a"]));
    expect(added).toMatchObject({
      workspaceId: "repo-b",
      repoPath: "/canonical/b",
      isActive: true,
    });
    expect(addedRepoConfig.defaultRuntimeKind).toBe("codex");
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
      Effect.runPromise(
        service.addWorkspace({
          workspaceId: "repo-b",
          workspaceName: "Repo B",
          repoPath: "/repos/b",
        }),
      ),
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
    const updated = await Effect.runPromise(
      service.updateRepoConfig("repo", {
        branchPrefix: " feature ",
        worktreeCopyPaths: [" .env ", "  "],
      }),
    );
    const saved = await Effect.runPromise(
      service.saveRepoSettings("repo", {
        worktreeBasePath: "   ",
        hooks: { preStart: [" bun lint ", ""], postComplete: [" bun test "] },
      }),
    );
    const repo = await Effect.runPromise(service.getRepoConfig("repo"));
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
    await expect(
      Effect.runPromise(service.getRepoConfigByRepoPath("/repo")),
    ).resolves.toMatchObject({
      workspaceId: "repo",
      repoPath: "/canonical/repo",
    });
    await expect(Effect.runPromise(service.getRepoConfigByRepoPath("/other"))).rejects.toThrow(
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
    await expect(Effect.runPromise(service.reorderWorkspaces(["repo-a"]))).rejects.toThrow(
      "Workspace reorder must include exactly 2 configured workspaces.",
    );
    await expect(
      Effect.runPromise(service.reorderWorkspaces(["repo-a", "repo-a"])),
    ).rejects.toThrow("Workspace reorder included duplicate workspace id: repo-a");
  });
  test("saves settings snapshots without changing theme and preserves workspace metadata", async () => {
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
    const snapshot = await Effect.runPromise(service.getSettingsSnapshot());
    const repoSnapshot = snapshot.workspaces.repo;
    if (!repoSnapshot) {
      throw new Error("expected repo workspace snapshot");
    }
    const explicitChatSettings = {
      showThinkingMessages: true,
      expandFileDiffsByDefault: false,
      diffStyle: "unified" as const,
      diffIndicators: "none" as const,
      diffHeight: "scroll" as const,
      lineOverflow: "scroll" as const,
      hunkSeparators: "simple" as const,
    };
    const explicitAppearanceSettings = {
      horizontalScrollbarVisibility: "show" as const,
    };
    const records = await Effect.runPromise(
      service.saveSettingsSnapshot({
        ...snapshot,
        appearance: explicitAppearanceSettings,
        chat: explicitChatSettings,
        agentRuntimes: {
          ...snapshot.agentRuntimes,
          codex: {
            enabled: true,
            executablePath: "/custom/codex",
            defaults: {
              sandboxMode: "danger-full-access",
              approvalPolicy: "never",
              approvalsReviewer: "auto_review",
              commandNetworkAccess: true,
            },
            roleOverrides: {
              spec: { sandboxMode: "read-only", approvalPolicy: "on-request" },
              planner: {
                sandboxMode: "read-only",
                approvalPolicy: "untrusted",
              },
              build: {
                sandboxMode: "workspace-write",
                approvalPolicy: "untrusted",
                commandNetworkAccess: true,
              },
              qa: {
                sandboxMode: "read-only",
                approvalPolicy: "on-request",
                approvalsReviewer: "user",
              },
            },
          },
        },
        workspaces: {
          repo: {
            ...repoSnapshot,
            repoPath: "/repos/repo",
          },
        },
      }),
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.repoPath).toBe("/canonical/repo");
    expect(settingsConfig.writtenConfigs[0]).toMatchObject({
      version: 3,
      activeWorkspace: "repo",
      theme: "light",
      workspaceOrder: ["repo"],
      workspaces: {
        repo: {
          repoPath: "/canonical/repo",
        },
      },
    });
    expect(settingsConfig.writtenConfigs[0]?.agentRuntimes?.codex).toEqual({
      enabled: true,
      executablePath: "/custom/codex",
      defaults: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        commandNetworkAccess: true,
      },
      roleOverrides: {
        spec: { sandboxMode: "read-only", approvalPolicy: "on-request" },
        planner: { sandboxMode: "read-only", approvalPolicy: "untrusted" },
        build: {
          sandboxMode: "workspace-write",
          approvalPolicy: "untrusted",
          commandNetworkAccess: true,
        },
        qa: {
          sandboxMode: "read-only",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
        },
      },
    });
    expect(settingsConfig.writtenConfigs[0]?.chat).toEqual(explicitChatSettings);
    expect(settingsConfig.writtenConfigs[0]?.appearance).toEqual(explicitAppearanceSettings);
  });
  test("does not let a failed theme write escape through a concurrent settings save", async () => {
    let rejectThemeWrite: ((reason: Error) => void) | undefined;
    let markThemeWriteStarted: (() => void) | undefined;
    const themeWriteStarted = new Promise<void>((resolve) => {
      markThemeWriteStarted = resolve;
    });
    const themeWriteResult = new Promise<void>((_resolve, reject) => {
      rejectThemeWrite = reject;
    });
    const settingsConfig = createFakeSettingsConfig({
      config: globalConfig(),
      beforeWrite: async (nextConfig) => {
        if (
          nextConfig.theme === "dark" &&
          nextConfig.general.openAgentStudioTabOnBackgroundSessionStart
        ) {
          markThemeWriteStarted?.();
          await themeWriteResult;
        }
      },
    });
    const service = createWorkspaceSettingsService(settingsConfig);
    const snapshot = await Effect.runPromise(service.getSettingsSnapshot());

    const themeWrite = Effect.runPromise(service.setTheme("dark"));
    await themeWriteStarted;
    const settingsWrite = Effect.runPromise(
      service.saveSettingsSnapshot({
        ...snapshot,
        general: { openAgentStudioTabOnBackgroundSessionStart: false },
      }),
    );
    rejectThemeWrite?.(new Error("theme write failed"));

    await expect(themeWrite).rejects.toThrow("theme write failed");
    await settingsWrite;
    const persisted = await Effect.runPromise(service.getSettingsSnapshot());
    expect(persisted.theme).toBe("light");
    expect(persisted.general.openAgentStudioTabOnBackgroundSessionStart).toBe(false);
  });
  test("preserves a queued favorite update when a full settings save starts first", async () => {
    let markSettingsWriteStarted: (() => void) | undefined;
    let releaseSettingsWrite: (() => void) | undefined;
    const settingsWriteStarted = new Promise<void>((resolve) => {
      markSettingsWriteStarted = resolve;
    });
    const settingsWriteGate = new Promise<void>((resolve) => {
      releaseSettingsWrite = resolve;
    });
    const oldFavorite = {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-4",
    };
    const newFavorite = {
      runtimeKind: "codex" as const,
      providerId: "openai",
      modelId: "gpt-5",
    };
    const settingsConfig = createFakeSettingsConfig({
      config: globalConfig({ agentModelFavorites: [oldFavorite] }),
      beforeWrite: async (nextConfig) => {
        if (!nextConfig.general.openAgentStudioTabOnBackgroundSessionStart) {
          markSettingsWriteStarted?.();
          await settingsWriteGate;
        }
      },
    });
    const service = createWorkspaceSettingsService(settingsConfig);
    const staleSnapshot = await Effect.runPromise(service.getSettingsSnapshot());

    const settingsWrite = Effect.runPromise(
      service.saveSettingsSnapshot({
        ...staleSnapshot,
        general: { openAgentStudioTabOnBackgroundSessionStart: false },
      }),
    );
    await settingsWriteStarted;
    const favoriteWrite = Effect.runPromise(service.updateAgentModelFavorites([newFavorite]));
    releaseSettingsWrite?.();

    await Promise.all([settingsWrite, favoriteWrite]);
    const persisted = await Effect.runPromise(service.getSettingsSnapshot());
    expect(persisted.general.openAgentStudioTabOnBackgroundSessionStart).toBe(false);
    expect(persisted.agentModelFavorites).toEqual([newFavorite]);
  });
  test("rejects a stale full settings save after a favorite update completes", async () => {
    let markFavoriteWriteStarted: (() => void) | undefined;
    let releaseFavoriteWrite: (() => void) | undefined;
    const favoriteWriteStarted = new Promise<void>((resolve) => {
      markFavoriteWriteStarted = resolve;
    });
    const favoriteWriteGate = new Promise<void>((resolve) => {
      releaseFavoriteWrite = resolve;
    });
    const oldFavorite = {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-4",
    };
    const newFavorite = {
      runtimeKind: "codex" as const,
      providerId: "openai",
      modelId: "gpt-5",
    };
    const settingsConfig = createFakeSettingsConfig({
      config: globalConfig({ agentModelFavorites: [oldFavorite] }),
      beforeWrite: async (nextConfig) => {
        if (nextConfig.agentModelFavorites[0]?.modelId === newFavorite.modelId) {
          markFavoriteWriteStarted?.();
          await favoriteWriteGate;
        }
      },
    });
    const service = createWorkspaceSettingsService(settingsConfig);
    const staleSnapshot = await Effect.runPromise(service.getSettingsSnapshot());

    const favoriteWrite = Effect.runPromise(service.updateAgentModelFavorites([newFavorite]));
    await favoriteWriteStarted;
    const settingsWrite = Effect.runPromise(
      service.saveSettingsSnapshot({
        ...staleSnapshot,
        general: { openAgentStudioTabOnBackgroundSessionStart: false },
      }),
    );
    releaseFavoriteWrite?.();

    await favoriteWrite;
    await expect(settingsWrite).rejects.toThrow(
      "Model favorites changed since settings were loaded. Reload settings and retry.",
    );
    const persisted = await Effect.runPromise(service.getSettingsSnapshot());
    expect(persisted.general.openAgentStudioTabOnBackgroundSessionStart).toBe(true);
    expect(persisted.agentModelFavorites).toEqual([newFavorite]);
  });
  test("rejects invalid appearance snapshot settings without writing config", async () => {
    const settingsConfig = createFakeSettingsConfig({
      config: globalConfig(),
    });
    const service = createWorkspaceSettingsService(settingsConfig);
    const snapshot = await Effect.runPromise(service.getSettingsSnapshot());

    await expect(
      Effect.runPromise(
        service.saveSettingsSnapshot({
          ...snapshot,
          appearance: {
            horizontalScrollbarVisibility: "auto",
          },
        } as unknown as typeof snapshot),
      ),
    ).rejects.toThrow("Invalid option");
    expect(settingsConfig.writtenConfigs).toHaveLength(0);
  });
  test("rejects invalid Codex snapshot settings without writing config", async () => {
    const settingsConfig = createFakeSettingsConfig({
      config: globalConfig(),
    });
    const service = createWorkspaceSettingsService(settingsConfig);
    const snapshot = await Effect.runPromise(service.getSettingsSnapshot());

    await expect(
      Effect.runPromise(
        service.saveSettingsSnapshot({
          ...snapshot,
          agentRuntimes: {
            ...snapshot.agentRuntimes,
            codex: {
              enabled: true,
              executablePath: "/bin/codex",
              defaults: { ...DEFAULT_CODEX_RUNTIME_POLICY },
              roleOverrides: { build: { sandboxMode: "read-only" } },
            },
          },
        }),
      ),
    ).rejects.toThrow("Codex build role sandboxMode cannot be read-only");
    expect(settingsConfig.writtenConfigs).toHaveLength(0);
  });
  test("rejects unknown snapshot workspaces", async () => {
    const service = createWorkspaceSettingsService(
      createFakeSettingsConfig({
        config: globalConfig(),
      }),
    );
    const snapshot = await Effect.runPromise(service.getSettingsSnapshot());
    await expect(
      Effect.runPromise(
        service.saveSettingsSnapshot({
          ...snapshot,
          workspaces: {
            repo: repoConfig("repo", "/repos/repo"),
          },
        }),
      ),
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
    const snapshot = await Effect.runPromise(service.getSettingsSnapshot());
    await expect(Effect.runPromise(service.saveSettingsSnapshot(snapshot))).rejects.toThrow(
      "Workspace is not a git repository: /repos/repo",
    );
  });
});
