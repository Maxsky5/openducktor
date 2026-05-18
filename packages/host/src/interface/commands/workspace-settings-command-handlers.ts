import {
  globalGitConfigSchema,
  repoHooksSchema,
  settingsSnapshotSchema,
  themeSchema,
} from "@openducktor/contracts";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlers } from "../router/host-command-router";
import { requireRecord, requireString } from "./command-inputs";

const requireNoArgs = (command: string, args: Record<string, unknown> | undefined): void => {
  if (args !== undefined && Object.keys(args).length > 0) {
    throw new HostValidationError({
      message: `${command} does not accept arguments.`,
      field: "args",
      details: { command },
    });
  }
};

const requireObjectArg = (
  command: string,
  args: Record<string, unknown> | undefined,
  key: string,
): unknown => {
  if (!args || !(key in args)) {
    throw new HostValidationError({
      message: `${command} expects argument '${key}'.`,
      field: key,
      details: { command },
    });
  }

  return args[key];
};

const requireStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new HostValidationError({
      message: `${label} must be an array of strings.`,
      field: label,
      details: { value },
    });
  }

  return value;
};

export const createWorkspaceSettingsCommandHandlers = (
  workspaceSettingsService: WorkspaceSettingsService,
): HostCommandHandlers => ({
  workspace_list: (args) => {
    requireNoArgs("workspace_list", args);
    return workspaceSettingsService.listWorkspaces();
  },
  workspace_add: (args) => {
    const record = requireRecord(args, "workspace_add input");
    return workspaceSettingsService.addWorkspace({
      workspaceId: requireString(record.workspaceId, "workspaceId"),
      workspaceName: requireString(record.workspaceName, "workspaceName"),
      repoPath: requireString(record.repoPath, "repoPath"),
    });
  },
  workspace_select: (args) =>
    workspaceSettingsService.selectWorkspace(
      requireString(requireObjectArg("workspace_select", args, "workspaceId"), "workspaceId"),
    ),
  workspace_reorder: (args) =>
    workspaceSettingsService.reorderWorkspaces(
      requireStringArray(
        requireObjectArg("workspace_reorder", args, "workspaceOrder"),
        "workspaceOrder",
      ),
    ),
  workspace_get_repo_config: (args) =>
    workspaceSettingsService.getRepoConfig(
      requireString(
        requireObjectArg("workspace_get_repo_config", args, "workspaceId"),
        "workspaceId",
      ),
    ),
  workspace_update_repo_config: (args) =>
    workspaceSettingsService.updateRepoConfig(
      requireString(
        requireObjectArg("workspace_update_repo_config", args, "workspaceId"),
        "workspaceId",
      ),
      requireRecord(
        requireObjectArg("workspace_update_repo_config", args, "config"),
        "workspace_update_repo_config config",
      ),
    ),
  workspace_save_repo_settings: (args) =>
    workspaceSettingsService.saveRepoSettings(
      requireString(
        requireObjectArg("workspace_save_repo_settings", args, "workspaceId"),
        "workspaceId",
      ),
      requireRecord(
        requireObjectArg("workspace_save_repo_settings", args, "settings"),
        "workspace_save_repo_settings settings",
      ),
    ),
  workspace_update_repo_hooks: (args) =>
    workspaceSettingsService.updateRepoHooks(
      requireString(
        requireObjectArg("workspace_update_repo_hooks", args, "workspaceId"),
        "workspaceId",
      ),
      repoHooksSchema.parse(requireObjectArg("workspace_update_repo_hooks", args, "hooks")),
    ),
  workspace_get_settings_snapshot: (args) => {
    requireNoArgs("workspace_get_settings_snapshot", args);
    return workspaceSettingsService.getSettingsSnapshot();
  },
  workspace_save_settings_snapshot: (args) =>
    workspaceSettingsService.saveSettingsSnapshot(
      settingsSnapshotSchema.parse(
        requireObjectArg("workspace_save_settings_snapshot", args, "snapshot"),
      ),
    ),
  set_theme: (args) =>
    workspaceSettingsService.setTheme(
      themeSchema.parse(requireObjectArg("set_theme", args, "theme")),
    ),
  workspace_update_global_git_config: (args) =>
    workspaceSettingsService.updateGlobalGitConfig(
      globalGitConfigSchema.parse(
        requireObjectArg("workspace_update_global_git_config", args, "git"),
      ),
    ),
});
