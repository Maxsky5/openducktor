import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { DEFAULT_AGENT_RUNTIMES, DEFAULT_NOTIFICATION_SETTINGS } from "@openducktor/contracts";
import { Effect } from "effect";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { HostOperationError } from "../../effect/host-errors";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createWorkspaceSettingsCommandHandlers } from "./workspace-settings-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

describe("createWorkspaceSettingsCommandHandlers", () => {
  test("routes settings snapshot commands through the workspace settings service", async () => {
    const calls: string[] = [];
    const addedWorkspaceInputs: Parameters<WorkspaceSettingsService["addWorkspace"]>[0][] = [];
    const service = createWorkspaceSettingsServiceTestDouble({
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
      addWorkspace(input: Parameters<WorkspaceSettingsService["addWorkspace"]>[0]) {
        addedWorkspaceInputs.push(input);
        return Effect.tryPromise({
          try: async () => {
            calls.push("addWorkspace");
            return {
              workspaceId: "repo",
              workspaceName: "repo",
              abbreviation: null,
              tileColor: null,
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
              abbreviation: null,
              tileColor: null,
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
      replaceAgentStudioState(_workspaceId, state) {
        return Effect.tryPromise({
          try: async () => {
            calls.push("replaceAgentStudioState");
            return {
              workspaceId: "repo",
              workspaceName: "repo",
              repoPath: "/repo",
              branchPrefix: "odt",
              defaultTargetBranch: { remote: "origin", branch: "main" },
              git: {},
              hooks: { preStart: [], postComplete: [] },
              devServers: [],
              worktreeCopyPaths: [],
              promptOverrides: {},
              agentDefaults: {},
              agentStudioState: state,
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
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
              branchPrefix: "odt",
              defaultTargetBranch: { remote: "origin", branch: "main" },
              git: {},
              hooks: { preStart: [], postComplete: [] },
              devServers: [],
              worktreeCopyPaths: [],
              promptOverrides: {},
              agentDefaults: {},
              agentStudioState: { openTaskIds: [] },
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
              abbreviation: null,
              tileColor: null,
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
              abbreviation: null,
              tileColor: null,
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
              abbreviation: null,
              tileColor: null,
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
              system: {},
              customAgentRoles: [],
              theme: "light",
              git: { defaultMergeMethod: "merge_commit" },
              general: { openAgentStudioTabOnBackgroundSessionStart: true },
              appearance: { horizontalScrollbarVisibility: "system" },
              chat: {
                showThinkingMessages: false,
                expandFileDiffsByDefault: false,
                diffStyle: "split",
                diffIndicators: "bars",
                diffHeight: "full",
                lineOverflow: "wrap",
                hunkSeparators: "metadata",
              },
              reusablePrompts: [],
              kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
              autopilot: { alwaysStartQaReviewsFresh: false, rules: [] },
              notifications: DEFAULT_NOTIFICATION_SETTINGS,
              agentRuntimes: DEFAULT_AGENT_RUNTIMES,
              agentModelFavorites: [],
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
      updateAgentModelFavorites() {
        return Effect.tryPromise({
          try: async () => {
            calls.push("updateAgentModelFavorites");
            return {
              system: {},
              customAgentRoles: [],
              theme: "light",
              git: { defaultMergeMethod: "merge_commit" },
              general: { openAgentStudioTabOnBackgroundSessionStart: true },
              appearance: { horizontalScrollbarVisibility: "system" },
              chat: {
                showThinkingMessages: false,
                expandFileDiffsByDefault: false,
                diffStyle: "split",
                diffIndicators: "bars",
                diffHeight: "full",
                lineOverflow: "wrap",
                hunkSeparators: "metadata",
              },
              reusablePrompts: [],
              kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
              autopilot: { alwaysStartQaReviewsFresh: false, rules: [] },
              notifications: DEFAULT_NOTIFICATION_SETTINGS,
              agentRuntimes: DEFAULT_AGENT_RUNTIMES,
              agentModelFavorites: [
                { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
              ],
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
      updateKanbanTaskCardView(taskCardView) {
        calls.push("updateKanbanTaskCardView");
        return Effect.succeed({
          system: {},
          customAgentRoles: [],
          theme: "light",
          git: { defaultMergeMethod: "merge_commit" },
          general: { openAgentStudioTabOnBackgroundSessionStart: true },
          appearance: { horizontalScrollbarVisibility: "system" },
          chat: {
            showThinkingMessages: false,
            expandFileDiffsByDefault: false,
            diffStyle: "split",
            diffIndicators: "bars",
            diffHeight: "full",
            lineOverflow: "wrap",
            hunkSeparators: "metadata",
          },
          reusablePrompts: [],
          kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView },
          autopilot: { alwaysStartQaReviewsFresh: false, rules: [] },
          notifications: DEFAULT_NOTIFICATION_SETTINGS,
          agentRuntimes: DEFAULT_AGENT_RUNTIMES,
          agentModelFavorites: [],
          workspaces: {},
          globalPromptOverrides: {},
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
    });
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
    expect(addedWorkspaceInputs.at(-1)).toEqual({
      workspaceId: "repo",
      workspaceName: "repo",
      repoPath: "/repo",
    });
    await expect(
      router.invoke("workspace_add", {
        workspaceId: "repo",
        workspaceName: "repo",
        repoPath: "/repo",
        abbreviation: "iOS",
        tileColor: "#f08c00",
      }),
    ).resolves.toMatchObject({ workspaceId: "repo" });
    expect(addedWorkspaceInputs.at(-1)).toEqual({
      workspaceId: "repo",
      workspaceName: "repo",
      repoPath: "/repo",
      abbreviation: "iOS",
      tileColor: "#f08c00",
    });
    await expect(router.invoke("workspace_select", { workspaceId: "repo" })).resolves.toMatchObject(
      { workspaceId: "repo" },
    );
    await expect(router.invoke("workspace_reorder", { workspaceOrder: ["repo"] })).resolves.toEqual(
      [],
    );
    await expect(
      router.invoke("workspace_replace_agent_studio_state", {
        workspaceId: "repo",
        state: {
          openTaskIds: ["task-1"],
          activeTask: { taskId: "task-1", role: "build", externalSessionId: "session-1" },
        },
      }),
    ).resolves.toMatchObject({
      agentStudioState: {
        openTaskIds: ["task-1"],
        activeTask: { taskId: "task-1", role: "build", externalSessionId: "session-1" },
      },
    });
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
      system: {},
      theme: "light",
    });
    await expect(
      router.invoke("workspace_save_settings_snapshot", {
        snapshot: {
          system: {},
          git: { defaultMergeMethod: "merge_commit" },
          general: { openAgentStudioTabOnBackgroundSessionStart: true },
          appearance: { horizontalScrollbarVisibility: "system" },
          chat: { showThinkingMessages: false },
          reusablePrompts: [],
          kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
          autopilot: { alwaysStartQaReviewsFresh: false, rules: [] },
          notifications: DEFAULT_NOTIFICATION_SETTINGS,
          agentRuntimes: {
            opencode: { enabled: true, executablePath: "/bin/opencode" },
            codex: { enabled: false, executablePath: "/bin/codex" },
          },
          agentModelFavorites: [],
          workspaces: {},
          globalPromptOverrides: {},
        },
      }),
    ).resolves.toEqual([]);
    await expect(
      router.invoke("workspace_update_agent_model_favorites", {
        favorites: [{ runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" }],
      }),
    ).resolves.toMatchObject({
      agentModelFavorites: [{ runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" }],
    });
    await expect(
      router.invoke("workspace_update_kanban_task_card_view", { taskCardView: "compact" }),
    ).resolves.toMatchObject({ kanban: { taskCardView: "compact" } });
    await expect(router.invoke("set_theme", { theme: "dark" })).resolves.toBeUndefined();
    await expect(
      router.invoke("workspace_update_global_git_config", {
        git: { defaultMergeMethod: "squash" },
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      "listWorkspaces",
      "addWorkspace",
      "addWorkspace",
      "selectWorkspace",
      "reorderWorkspaces",
      "replaceAgentStudioState",
      "getRepoConfig",
      "updateRepoConfig",
      "saveRepoSettings",
      "updateRepoHooks",
      "getSettingsSnapshot",
      "saveSettingsSnapshot",
      "updateAgentModelFavorites",
      "updateKanbanTaskCardView",
      "setTheme",
      "updateGlobalGitConfig",
    ]);
  });
  test("rejects malformed settings command arguments", async () => {
    const service = createWorkspaceSettingsServiceTestDouble({
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
    });
    const router = createHostCommandRouter({
      handlers: createWorkspaceSettingsCommandHandlers(service),
    });
    await expect(router.invoke("workspace_get_settings_snapshot", { extra: true })).rejects.toThrow(
      "workspace_get_settings_snapshot does not accept arguments.",
    );
    await expect(router.invoke("workspace_save_settings_snapshot")).rejects.toThrow(
      "workspace_save_settings_snapshot expects argument 'snapshot'.",
    );
    await expect(
      router.invoke("workspace_save_settings_snapshot", {
        snapshot: {
          system: {},
          git: { defaultMergeMethod: "merge_commit" },
          general: { openAgentStudioTabOnBackgroundSessionStart: true },
          appearance: { horizontalScrollbarVisibility: "auto" },
          chat: {
            showThinkingMessages: false,
            expandFileDiffsByDefault: false,
            diffStyle: "split",
            diffIndicators: "bars",
            diffHeight: "full",
            lineOverflow: "wrap",
            hunkSeparators: "metadata",
          },
          reusablePrompts: [],
          kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
          autopilot: { alwaysStartQaReviewsFresh: false, rules: [] },
          agentRuntimes: DEFAULT_AGENT_RUNTIMES,
          agentModelFavorites: [],
          workspaces: {},
          globalPromptOverrides: {},
        },
      }),
    ).rejects.toThrow(
      /appearance\.horizontalScrollbarVisibility: Invalid option.*\(found "auto"\)/,
    );
    await expect(router.invoke("set_theme", { theme: "blue" })).rejects.toThrow(
      /config: Invalid option.*\(found "blue"\)/,
    );
    await expect(router.invoke("workspace_select")).rejects.toThrow(
      "workspace_select expects argument 'workspaceId'.",
    );
    await expect(
      router.invoke("workspace_replace_agent_studio_state", {
        workspaceId: "repo",
        state: { openTaskIds: [42] },
      }),
    ).rejects.toThrow("workspace_replace_agent_studio_state state is invalid");
    await expect(
      router.invoke("workspace_add", {
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        abbreviation: 42,
      }),
    ).rejects.toThrow("abbreviation");
    await expect(
      router.invoke("workspace_add", {
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        tileColor: false,
      }),
    ).rejects.toThrow("tileColor");
  });
});
