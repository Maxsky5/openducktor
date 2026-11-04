import { createHostRuntimeServiceTestDouble } from "../../test-support/host-runtime-service-test-double";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import {
  DEFAULT_AGENT_RUNTIMES,
  settingsSnapshotSchema,
  type SidebarSessionGrouping,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostRuntimeService } from "../../application/runtimes/host-runtime-service";
import { HostOperationError } from "../../effect/host-errors";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createWorkspaceSettingsCommandHandlers } from "./workspace-settings-command-handlers";
import { createBuiltinNotificationSettings } from "@openducktor/workflows";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

describe("createWorkspaceSettingsCommandHandlers", () => {
  test("validates sidebar grouping before dispatch and returns the saved mode", async () => {
    const snapshot = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit", removeWorktreeOnClose: true },
      appearance: { sidebarSessionGrouping: "none" },
      workspaces: {},
      globalPromptOverrides: {},
    });
    const calls: SidebarSessionGrouping[] = [];
    const service = createWorkspaceSettingsServiceTestDouble({
      updateSidebarSessionGrouping(grouping) {
        calls.push(grouping);
        return Effect.succeed(snapshot.appearance.sidebarSessionGrouping);
      },
    });
    const router = createHostCommandRouter({
      handlers: createWorkspaceSettingsCommandHandlers(
        service,
        createHostRuntimeServiceTestDouble(),
      ),
    });
    expect(
      await router.invoke("workspace_update_sidebar_session_grouping", { grouping: "none" }),
    ).toEqual(snapshot.appearance.sidebarSessionGrouping);
    await expect(
      router.invoke("workspace_update_sidebar_session_grouping", { grouping: "role" }),
    ).rejects.toThrow(/expected one of/);
    await expect(router.invoke("workspace_update_sidebar_session_grouping", {})).rejects.toThrow(
      /expects argument 'grouping'/,
    );
    expect(calls).toEqual(["none"]);
  });

  test("routes settings snapshot commands through the workspace settings service", async () => {
    const calls: string[] = [];
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
              hooks: { postComplete: [] },
              actions: { items: [], defaultActionId: null },
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
      applyAgentStudioStateAction(_workspaceId, action) {
        calls.push("applyAgentStudioStateAction");
        return Effect.succeed({
          workspaceId: "repo",
          workspaceName: "repo",
          repoPath: "/repo",
          branchPrefix: "odt",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {},
          hooks: { postComplete: [] },
          actions: { items: [], defaultActionId: null },
          worktreeCopyPaths: [],
          promptOverrides: {},
          agentDefaults: {},
          agentStudioState: {
            openTaskIds: action.type === "ensure_tab" ? [action.taskId] : [],
          },
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
              hooks: { postComplete: [] },
              actions: { items: [], defaultActionId: null },
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
      getSettingsSnapshot() {
        return Effect.sync(() => {
          calls.push("getSettingsSnapshot");
          return {
            system: {},
            customAgentRoles: [],
            theme: "light",
            git: { defaultMergeMethod: "merge_commit", removeWorktreeOnClose: true },
            general: { openAgentStudioTabOnBackgroundSessionStart: true },
            appearance: { horizontalScrollbarVisibility: "system", sidebarSessionGrouping: "task" },
            chat: {
              steerMessagesByDefault: false,
              showThinkingMessages: false,
              expandFileDiffsByDefault: false,
              diffStyle: "split",
              diffIndicators: "bars",
              diffHeight: "full",
              lineOverflow: "wrap",
              hunkSeparators: "metadata",
              showConversationMinimap: true,
            },
            reusablePrompts: [],
            kanban: { doneVisibleDays: 1, emptyColumnDisplay: "show", taskCardView: "normal" },
            autopilot: { alwaysStartQaReviewsFresh: false, rules: [] },
            notifications: createBuiltinNotificationSettings(),
            agentRuntimes: DEFAULT_AGENT_RUNTIMES,
            agentModelFavorites: [],
            workspaces: {},
            globalPromptOverrides: {},
          };
        });
      },
      updateAgentModelFavorites(favorites) {
        calls.push("updateAgentModelFavorites");
        return Effect.succeed(favorites);
      },
      updateKanbanTaskCardView(taskCardView) {
        calls.push("updateKanbanTaskCardView");
        return Effect.succeed(taskCardView);
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
    });
    const savedRuntimeInputs: Parameters<HostRuntimeService["saveSettings"]>[0][] = [];
    const hostRuntimeService = createHostRuntimeServiceTestDouble({
      saveSettings: (input) =>
        Effect.sync(() => {
          calls.push("saveSettings");
          savedRuntimeInputs.push(input);
          return {
            type: "saved" as const,
            shared: "saved" as const,
            preferences: "saved" as const,
            workspaces: [],
            runtimeApplications: [],
          };
        }),
    });
    const router = createHostCommandRouter({
      handlers: createWorkspaceSettingsCommandHandlers(service, hostRuntimeService),
    });
    await expect(router.invoke("workspace_list")).resolves.toEqual([]);
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
      router.invoke("workspace_apply_agent_studio_state_action", {
        workspaceId: "repo",
        action: { type: "ensure_tab", taskId: "task-2" },
      }),
    ).resolves.toMatchObject({ agentStudioState: { openTaskIds: ["task-2"] } });
    await expect(
      router.invoke("workspace_get_repo_config", { workspaceId: "repo" }),
    ).resolves.toMatchObject({ workspaceId: "repo" });
    await expect(router.invoke("workspace_get_settings_snapshot")).resolves.toMatchObject({
      system: {},
      theme: "light",
    });
    await expect(
      router.invoke("workspace_save_settings_snapshot", {
        snapshot: {
          global: {
            chat: { showThinkingMessages: false },
            agentRuntimes: {
              opencode: { enabled: true, executablePath: "/bin/opencode" },
              codex: { enabled: false, executablePath: "/bin/codex" },
            },
          },
        },
        runtimeConfirmation: "confirmation-1",
      }),
    ).resolves.toEqual({
      type: "saved",
      shared: "saved",
      preferences: "saved",
      workspaces: [],
      runtimeApplications: [],
    });
    expect(savedRuntimeInputs).toHaveLength(1);
    expect(savedRuntimeInputs[0]?.runtimeConfirmation).toBe("confirmation-1");
    expect(savedRuntimeInputs[0]?.snapshot.global?.agentRuntimes).toMatchObject({
      opencode: { enabled: true, executablePath: "/bin/opencode" },
      codex: { enabled: false, executablePath: "/bin/codex" },
    });
    await expect(
      router.invoke("workspace_update_agent_model_favorites", {
        favorites: [{ runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" }],
      }),
    ).resolves.toEqual([{ runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" }]);
    await expect(
      router.invoke("workspace_update_kanban_task_card_view", { taskCardView: "compact" }),
    ).resolves.toBe("compact");
    await expect(router.invoke("set_theme", { theme: "dark" })).resolves.toBeUndefined();
    expect(calls).toEqual([
      "listWorkspaces",
      "selectWorkspace",
      "reorderWorkspaces",
      "replaceAgentStudioState",
      "applyAgentStudioStateAction",
      "getRepoConfig",
      "getSettingsSnapshot",
      "saveSettings",
      "updateAgentModelFavorites",
      "updateKanbanTaskCardView",
      "setTheme",
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
    });
    const router = createHostCommandRouter({
      handlers: createWorkspaceSettingsCommandHandlers(
        service,
        createHostRuntimeServiceTestDouble(),
      ),
    });
    await expect(router.invoke("workspace_get_settings_snapshot", { extra: true })).rejects.toThrow(
      "workspace_get_settings_snapshot does not accept arguments.",
    );
    await expect(router.invoke("workspace_save_settings_snapshot")).rejects.toThrow(
      "workspace_save_settings_snapshot expects argument 'snapshot'.",
    );
    await expect(
      router.invoke("workspace_save_settings_snapshot", {
        snapshot: { global: { appearance: { horizontalScrollbarVisibility: "auto" } } },
      }),
    ).rejects.toThrow(
      /appearance\.horizontalScrollbarVisibility: Invalid option.*\(found "auto"\)/,
    );
    await expect(router.invoke("set_theme", { theme: "blue" })).rejects.toThrow(
      /config: Invalid option.*\(found "blue"\)/,
    );
    await expect(
      router.invoke("workspace_update_kanban_task_card_view", { taskCardView: "dense" }),
    ).rejects.toThrow(/config: Invalid option.*\(found "dense"\)/);
    await expect(router.invoke("workspace_select")).rejects.toThrow(
      "workspace_select expects argument 'workspaceId'.",
    );
    await expect(
      router.invoke("workspace_replace_agent_studio_state", {
        workspaceId: "repo",
        state: { openTaskIds: [42] },
      }),
    ).rejects.toThrow("workspace_replace_agent_studio_state state is invalid");
  });

  test("previews runtime impact and validates the save confirmation", async () => {
    const snapshot = {
      global: { agentRuntimes: { opencode: { enabled: false, executablePath: "/bin/opencode" } } },
    };
    const impact = {
      kinds: [
        {
          kind: "opencode" as const,
          runtimeId: "runtime-1",
          effect: "stop" as const,
          oldExecutablePath: "/bin/opencode",
          newExecutablePath: null,
        },
      ],
      workspaces: [],
      confirmation: "confirmation-1",
    };
    const previewed: Parameters<HostRuntimeService["previewSettings"]>[0][] = [];
    const router = createHostCommandRouter({
      handlers: createWorkspaceSettingsCommandHandlers(
        createWorkspaceSettingsServiceTestDouble({}),
        createHostRuntimeServiceTestDouble({
          previewSettings: (input) =>
            Effect.sync(() => {
              previewed.push(input);
              return { impact };
            }),
        }),
      ),
    });
    await expect(
      router.invoke("workspace_preview_settings_snapshot_runtime", { snapshot }),
    ).resolves.toEqual({ impact });
    expect(previewed).toHaveLength(1);
    expect(previewed[0]?.global?.agentRuntimes?.opencode).toMatchObject({
      enabled: false,
      executablePath: "/bin/opencode",
    });
    await expect(router.invoke("workspace_preview_settings_snapshot_runtime")).rejects.toThrow(
      "workspace_preview_settings_snapshot_runtime expects argument 'snapshot'.",
    );
    await expect(
      router.invoke("workspace_save_settings_snapshot", { snapshot, runtimeConfirmation: 42 }),
    ).rejects.toThrow("workspace_save_settings_snapshot runtimeConfirmation must be a string.");
    expect(previewed).toHaveLength(1);
  });
});
