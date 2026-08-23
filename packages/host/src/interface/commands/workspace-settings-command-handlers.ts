import {
  agentModelFavoritesSchema,
  globalGitConfigSchema,
  repoHooksSchema,
  runtimeKindSchema,
  settingsSnapshotSaveInputSchema,
  themeSchema,
  workspaceRepoConfigInputSchema,
  workspaceRepoSettingsInputSchema,
  type WorkspaceRepoConfigInput,
  type WorkspaceRepoSettingsInput,
  runtimeTypeName,
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

const requireObjectArgs = (
  command: string,
  args: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> => {
  if (!args || !(key in args)) {
    throw new HostValidationError({
      message: `${command} expects argument '${key}'.`,
      field: key,
      details: { command },
    });
  }

  return args;
};

const requireStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) {
    throw new HostValidationError({
      message: `${label} must be an array of strings.`,
      field: label,
      details: { receivedType: runtimeTypeName(value) },
    });
  }
  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
};

const optionalRuntimeKind = (record: Record<string, unknown>) => {
  if (record.defaultRuntimeKind === undefined) return undefined;
  const parsed = runtimeKindSchema.safeParse(record.defaultRuntimeKind);
  if (!parsed.success) {
    throw new HostValidationError({
      message: "defaultRuntimeKind must be a supported runtime kind.",
      field: "defaultRuntimeKind",
      details: { receivedType: runtimeTypeName(record.defaultRuntimeKind) },
    });
  }
  return parsed.data;
};

const parseRepoConfigInput = (value: unknown): WorkspaceRepoConfigInput => {
  const parsed = workspaceRepoConfigInputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HostValidationError({
    message: `workspace_update_repo_config config is invalid: ${parsed.error.message}`,
    field: "config",
    cause: parsed.error,
  });
};

const parseRepoSettingsInput = (value: unknown): WorkspaceRepoSettingsInput => {
  const parsed = workspaceRepoSettingsInputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HostValidationError({
    message: `workspace_save_repo_settings settings is invalid: ${parsed.error.message}`,
    field: "settings",
    cause: parsed.error,
  });
};

export const createWorkspaceSettingsCommandHandlers = (
  workspaceSettingsService: Pick<
    WorkspaceSettingsService,
    | "addWorkspace"
    | "getRepoConfig"
    | "getSettingsSnapshot"
    | "listWorkspaces"
    | "reorderWorkspaces"
    | "saveRepoSettings"
    | "saveSettingsSnapshot"
    | "selectWorkspace"
    | "setTheme"
    | "updateAgentModelFavorites"
    | "updateGlobalGitConfig"
    | "updateRepoConfig"
    | "updateRepoHooks"
  >,
): HostCommandHandlers => ({
  workspace_list: (args) => {
    requireNoArgs("workspace_list", args);
    return workspaceSettingsService.listWorkspaces();
  },
  workspace_add: (args) => {
    const record = requireRecord(args, "workspace_add input");
    const defaultRuntimeKind = optionalRuntimeKind(record);
    return workspaceSettingsService.addWorkspace({
      workspaceId: requireString(record.workspaceId, "workspaceId"),
      workspaceName: requireString(record.workspaceName, "workspaceName"),
      repoPath: requireString(record.repoPath, "repoPath"),
      ...(defaultRuntimeKind ? { defaultRuntimeKind } : undefined),
    });
  },
  workspace_select: (args) =>
    workspaceSettingsService.selectWorkspace(
      requireString(
        requireObjectArgs("workspace_select", args, "workspaceId").workspaceId,
        "workspaceId",
      ),
    ),
  workspace_reorder: (args) =>
    workspaceSettingsService.reorderWorkspaces(
      requireStringArray(
        requireObjectArgs("workspace_reorder", args, "workspaceOrder").workspaceOrder,
        "workspaceOrder",
      ),
    ),
  workspace_get_repo_config: (args) =>
    workspaceSettingsService.getRepoConfig(
      requireString(
        requireObjectArgs("workspace_get_repo_config", args, "workspaceId").workspaceId,
        "workspaceId",
      ),
    ),
  workspace_update_repo_config: (args) =>
    workspaceSettingsService.updateRepoConfig(
      requireString(
        requireObjectArgs("workspace_update_repo_config", args, "workspaceId").workspaceId,
        "workspaceId",
      ),
      parseRepoConfigInput(
        requireObjectArgs("workspace_update_repo_config", args, "config").config,
      ),
    ),
  workspace_save_repo_settings: (args) =>
    workspaceSettingsService.saveRepoSettings(
      requireString(
        requireObjectArgs("workspace_save_repo_settings", args, "workspaceId").workspaceId,
        "workspaceId",
      ),
      parseRepoSettingsInput(
        requireObjectArgs("workspace_save_repo_settings", args, "settings").settings,
      ),
    ),
  workspace_update_repo_hooks: (args) =>
    workspaceSettingsService.updateRepoHooks(
      requireString(
        requireObjectArgs("workspace_update_repo_hooks", args, "workspaceId").workspaceId,
        "workspaceId",
      ),
      repoHooksSchema.parse(requireObjectArgs("workspace_update_repo_hooks", args, "hooks").hooks),
    ),
  workspace_get_settings_snapshot: (args) => {
    requireNoArgs("workspace_get_settings_snapshot", args);
    return workspaceSettingsService.getSettingsSnapshot();
  },
  workspace_save_settings_snapshot: (args) =>
    workspaceSettingsService.saveSettingsSnapshot(
      settingsSnapshotSaveInputSchema.parse(
        requireObjectArgs("workspace_save_settings_snapshot", args, "snapshot").snapshot,
      ),
    ),
  workspace_update_agent_model_favorites: (args) =>
    workspaceSettingsService.updateAgentModelFavorites(
      agentModelFavoritesSchema.parse(
        requireObjectArgs("workspace_update_agent_model_favorites", args, "favorites").favorites,
      ),
    ),
  set_theme: (args) =>
    workspaceSettingsService.setTheme(
      themeSchema.parse(requireObjectArgs("set_theme", args, "theme").theme),
    ),
  workspace_update_global_git_config: (args) =>
    workspaceSettingsService.updateGlobalGitConfig(
      globalGitConfigSchema.parse(
        requireObjectArgs("workspace_update_global_git_config", args, "git").git,
      ),
    ),
});
