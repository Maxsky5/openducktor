import { createHostCommandRouter } from "./host-command-router";
import { createWorkspaceSettingsCommandHandlers } from "./workspace-settings-command-handlers";
import type { WorkspaceSettingsService } from "./workspace-settings-service";

describe("createWorkspaceSettingsCommandHandlers", () => {
  test("routes settings snapshot commands through the workspace settings service", async () => {
    const calls: string[] = [];
    const service: WorkspaceSettingsService = {
      async listWorkspaces() {
        calls.push("listWorkspaces");
        return [];
      },
      async addWorkspace() {
        calls.push("addWorkspace");
        return {
          workspaceId: "repo",
          workspaceName: "repo",
          repoPath: "/repo",
          iconDataUrl: null,
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: "/worktrees/repo",
          effectiveWorktreeBasePath: "/worktrees/repo",
        };
      },
      async selectWorkspace() {
        calls.push("selectWorkspace");
        return {
          workspaceId: "repo",
          workspaceName: "repo",
          repoPath: "/repo",
          iconDataUrl: null,
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: "/worktrees/repo",
          effectiveWorktreeBasePath: "/worktrees/repo",
        };
      },
      async reorderWorkspaces() {
        calls.push("reorderWorkspaces");
        return [];
      },
      async getRepoConfig() {
        calls.push("getRepoConfig");
        return {
          workspaceId: "repo",
          workspaceName: "repo",
          repoPath: "/repo",
          defaultRuntimeKind: "opencode",
          branchPrefix: "odt",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: { providers: {} },
          hooks: { preStart: [], postComplete: [] },
          devServers: [],
          worktreeCopyPaths: [],
          promptOverrides: {},
          agentDefaults: {},
        };
      },
      async updateRepoConfig() {
        calls.push("updateRepoConfig");
        return {
          workspaceId: "repo",
          workspaceName: "repo",
          repoPath: "/repo",
          iconDataUrl: null,
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: "/worktrees/repo",
          effectiveWorktreeBasePath: "/worktrees/repo",
        };
      },
      async saveRepoSettings() {
        calls.push("saveRepoSettings");
        return {
          workspaceId: "repo",
          workspaceName: "repo",
          repoPath: "/repo",
          iconDataUrl: null,
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: "/worktrees/repo",
          effectiveWorktreeBasePath: "/worktrees/repo",
        };
      },
      async updateRepoHooks() {
        calls.push("updateRepoHooks");
        return {
          workspaceId: "repo",
          workspaceName: "repo",
          repoPath: "/repo",
          iconDataUrl: null,
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: "/worktrees/repo",
          effectiveWorktreeBasePath: "/worktrees/repo",
        };
      },
      async getSettingsSnapshot() {
        calls.push("getSettingsSnapshot");
        return {
          theme: "light",
          git: { defaultMergeMethod: "merge_commit" },
          general: { openAgentStudioTabOnBackgroundSessionStart: true },
          chat: { showThinkingMessages: false },
          reusablePrompts: [],
          kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show" },
          autopilot: { rules: [] },
          agentRuntimes: { opencode: { enabled: true }, codex: { enabled: false } },
          workspaces: {},
          globalPromptOverrides: {},
        };
      },
      async saveSettingsSnapshot() {
        calls.push("saveSettingsSnapshot");
        return [];
      },
      async setTheme() {
        calls.push("setTheme");
      },
      async updateGlobalGitConfig() {
        calls.push("updateGlobalGitConfig");
      },
    };
    const router = createHostCommandRouter({
      handlers: createWorkspaceSettingsCommandHandlers(service),
    });

    await expect(router.invoke("workspace_list")).resolves.toEqual([]);
    await expect(
      router.invoke("workspace_add", {
        workspaceId: "repo",
        workspaceName: "repo",
        repoPath: "/repo",
      }),
    ).resolves.toMatchObject({ workspaceId: "repo" });
    await expect(router.invoke("workspace_select", { workspaceId: "repo" })).resolves.toMatchObject(
      { workspaceId: "repo" },
    );
    await expect(router.invoke("workspace_reorder", { workspaceOrder: ["repo"] })).resolves.toEqual(
      [],
    );
    await expect(
      router.invoke("workspace_get_repo_config", { workspaceId: "repo" }),
    ).resolves.toMatchObject({ workspaceId: "repo" });
    await expect(
      router.invoke("workspace_update_repo_config", {
        workspaceId: "repo",
        config: { branchPrefix: "odt" },
      }),
    ).resolves.toMatchObject({ workspaceId: "repo" });
    await expect(
      router.invoke("workspace_save_repo_settings", {
        workspaceId: "repo",
        settings: { branchPrefix: "odt" },
      }),
    ).resolves.toMatchObject({ workspaceId: "repo" });
    await expect(
      router.invoke("workspace_update_repo_hooks", {
        workspaceId: "repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    ).resolves.toMatchObject({ workspaceId: "repo" });
    await expect(router.invoke("workspace_get_settings_snapshot")).resolves.toMatchObject({
      theme: "light",
    });
    await expect(
      router.invoke("workspace_save_settings_snapshot", { snapshot: { theme: "light" } }),
    ).resolves.toEqual([]);
    await expect(router.invoke("set_theme", { theme: "dark" })).resolves.toBeUndefined();
    await expect(
      router.invoke("workspace_update_global_git_config", {
        git: { defaultMergeMethod: "squash" },
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      "listWorkspaces",
      "addWorkspace",
      "selectWorkspace",
      "reorderWorkspaces",
      "getRepoConfig",
      "updateRepoConfig",
      "saveRepoSettings",
      "updateRepoHooks",
      "getSettingsSnapshot",
      "saveSettingsSnapshot",
      "setTheme",
      "updateGlobalGitConfig",
    ]);
  });

  test("rejects malformed settings command arguments", async () => {
    const service: WorkspaceSettingsService = {
      async listWorkspaces() {
        return [];
      },
      async addWorkspace() {
        throw new Error("should not call addWorkspace");
      },
      async selectWorkspace() {
        throw new Error("should not call selectWorkspace");
      },
      async reorderWorkspaces() {
        throw new Error("should not call reorderWorkspaces");
      },
      async getRepoConfig() {
        throw new Error("should not call getRepoConfig");
      },
      async updateRepoConfig() {
        throw new Error("should not call updateRepoConfig");
      },
      async saveRepoSettings() {
        throw new Error("should not call saveRepoSettings");
      },
      async updateRepoHooks() {
        throw new Error("should not call updateRepoHooks");
      },
      async getSettingsSnapshot() {
        throw new Error("should not call getSettingsSnapshot");
      },
      async saveSettingsSnapshot() {
        throw new Error("should not call saveSettingsSnapshot");
      },
      async setTheme() {
        throw new Error("should not call setTheme");
      },
      async updateGlobalGitConfig() {
        throw new Error("should not call updateGlobalGitConfig");
      },
    };
    const router = createHostCommandRouter({
      handlers: createWorkspaceSettingsCommandHandlers(service),
    });

    await expect(router.invoke("workspace_get_settings_snapshot", { extra: true })).rejects.toThrow(
      "workspace_get_settings_snapshot does not accept arguments.",
    );
    await expect(router.invoke("workspace_save_settings_snapshot")).rejects.toThrow(
      "workspace_save_settings_snapshot expects argument 'snapshot'.",
    );
    await expect(router.invoke("workspace_select")).rejects.toThrow(
      "workspace_select expects argument 'workspaceId'.",
    );
  });
});
