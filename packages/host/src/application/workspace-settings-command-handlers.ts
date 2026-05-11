import type { HostCommandHandlers } from "./host-command-router";
import type { WorkspaceSettingsService } from "./workspace-settings-service";

const requireNoArgs = (command: string, args: Record<string, unknown> | undefined): void => {
  if (args !== undefined && Object.keys(args).length > 0) {
    throw new Error(`${command} does not accept arguments.`);
  }
};

const requireObjectArg = (
  command: string,
  args: Record<string, unknown> | undefined,
  key: string,
): unknown => {
  if (!args || !(key in args)) {
    throw new Error(`${command} expects argument '${key}'.`);
  }

  return args[key];
};

export const createWorkspaceSettingsCommandHandlers = (
  workspaceSettingsService: WorkspaceSettingsService,
): HostCommandHandlers => ({
  workspace_list: (args) => {
    requireNoArgs("workspace_list", args);
    return workspaceSettingsService.listWorkspaces();
  },
  workspace_add: (args) => workspaceSettingsService.addWorkspace(args),
  workspace_select: (args) =>
    workspaceSettingsService.selectWorkspace(
      requireObjectArg("workspace_select", args, "workspaceId"),
    ),
  workspace_reorder: (args) =>
    workspaceSettingsService.reorderWorkspaces(
      requireObjectArg("workspace_reorder", args, "workspaceOrder"),
    ),
  workspace_get_repo_config: (args) =>
    workspaceSettingsService.getRepoConfig(
      requireObjectArg("workspace_get_repo_config", args, "workspaceId"),
    ),
  workspace_update_repo_config: (args) =>
    workspaceSettingsService.updateRepoConfig(
      requireObjectArg("workspace_update_repo_config", args, "workspaceId"),
      requireObjectArg("workspace_update_repo_config", args, "config"),
    ),
  workspace_save_repo_settings: (args) =>
    workspaceSettingsService.saveRepoSettings(
      requireObjectArg("workspace_save_repo_settings", args, "workspaceId"),
      requireObjectArg("workspace_save_repo_settings", args, "settings"),
    ),
  workspace_update_repo_hooks: (args) =>
    workspaceSettingsService.updateRepoHooks(
      requireObjectArg("workspace_update_repo_hooks", args, "workspaceId"),
      requireObjectArg("workspace_update_repo_hooks", args, "hooks"),
    ),
  workspace_get_settings_snapshot: (args) => {
    requireNoArgs("workspace_get_settings_snapshot", args);
    return workspaceSettingsService.getSettingsSnapshot();
  },
  workspace_save_settings_snapshot: (args) =>
    workspaceSettingsService.saveSettingsSnapshot(
      requireObjectArg("workspace_save_settings_snapshot", args, "snapshot"),
    ),
  set_theme: (args) =>
    workspaceSettingsService.setTheme(requireObjectArg("set_theme", args, "theme")),
  workspace_update_global_git_config: (args) =>
    workspaceSettingsService.updateGlobalGitConfig(
      requireObjectArg("workspace_update_global_git_config", args, "git"),
    ),
});
