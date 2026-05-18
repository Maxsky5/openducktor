import { Effect } from "effect";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { HostOperationError } from "../../effect/host-errors";
import { createHostCommandRouter } from "../router/host-command-router";
import { createWorkspaceSettingsCommandHandlers } from "./workspace-settings-command-handlers";

describe("createWorkspaceSettingsCommandHandlers", () => {
  test("routes settings snapshot commands through the workspace settings service", async () => {
    const calls: string[] = [];
    const service = {
      listWorkspaces() {
        return Effect.tryPromise({
          try: async () => {
            calls.push("listWorkspaces");
            return [];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      addWorkspace() {
        return Effect.tryPromise({
          try: async () => {
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
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      selectWorkspace() {
        return Effect.tryPromise({
          try: async () => {
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
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      reorderWorkspaces() {
        return Effect.tryPromise({
          try: async () => {
            calls.push("reorderWorkspaces");
            return [];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getRepoConfig() {
        return Effect.tryPromise({
          try: async () => {
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
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateRepoConfig() {
        return Effect.tryPromise({
          try: async () => {
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
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      saveRepoSettings() {
        return Effect.tryPromise({
          try: async () => {
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
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateRepoHooks() {
        return Effect.tryPromise({
          try: async () => {
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
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getSettingsSnapshot() {
        return Effect.tryPromise({
          try: async () => {
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
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      saveSettingsSnapshot() {
        return Effect.tryPromise({
          try: async () => {
            calls.push("saveSettingsSnapshot");
            return [];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setTheme() {
        return Effect.tryPromise({
          try: async () => {
            calls.push("setTheme");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateGlobalGitConfig() {
        return Effect.tryPromise({
          try: async () => {
            calls.push("updateGlobalGitConfig");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    } as unknown as WorkspaceSettingsService;
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
    const service = {
      listWorkspaces() {
        return Effect.tryPromise({
          try: async () => {
            return [];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      addWorkspace() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call addWorkspace");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      selectWorkspace() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call selectWorkspace");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      reorderWorkspaces() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call reorderWorkspaces");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getRepoConfig() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call getRepoConfig");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateRepoConfig() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call updateRepoConfig");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      saveRepoSettings() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call saveRepoSettings");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateRepoHooks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call updateRepoHooks");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getSettingsSnapshot() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call getSettingsSnapshot");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      saveSettingsSnapshot() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call saveSettingsSnapshot");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setTheme() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call setTheme");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateGlobalGitConfig() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call updateGlobalGitConfig");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    } as unknown as WorkspaceSettingsService;
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
