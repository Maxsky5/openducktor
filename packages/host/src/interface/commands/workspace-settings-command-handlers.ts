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
} from "@openducktor/contracts";
import { z } from "zod";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputRecordSchema,
  commandInputStringSchema,
  type CommandInputRecord,
  type HostCommandArgs,
  requireRecord,
  requireString,
} from "./command-inputs";

const requireNoArgs = (command: string, args: HostCommandArgs): void => {
  const record =
    args === undefined
      ? undefined
      : requireRecord(commandInputRecordSchema.safeParse(args), `${command} input`);
  if (record !== undefined && Object.keys(record).length > 0) {
    throw new HostValidationError({
      message: `${command} does not accept arguments.`,
      field: "args",
      details: { command },
    });
  }
};

const requireObjectArgs = (
  command: string,
  args: HostCommandArgs,
  key: string,
): CommandInputRecord => {
  const record =
    args === undefined
      ? undefined
      : requireRecord(commandInputRecordSchema.safeParse(args), `${command} input`);
  if (record === undefined || !(key in record)) {
    throw new HostValidationError({
      message: `${command} expects argument '${key}'.`,
      field: key,
      details: { command },
    });
  }

  return record;
};

const commandInputArraySchema = z.array(z.unknown());

const requireStringArray = (result: z.ZodSafeParseResult<unknown[]>, label: string): string[] => {
  if (!result.success) {
    throw new HostValidationError({
      message: `${label} must be an array of strings.`,
      field: label,
      cause: result.error,
    });
  }
  return result.data.map((entry, index) =>
    requireString(commandInputStringSchema.safeParse(entry), `${label}[${index}]`),
  );
};

const optionalRuntimeKind = (record: CommandInputRecord) => {
  if (record.defaultRuntimeKind === undefined) return undefined;
  const parsed = runtimeKindSchema.safeParse(record.defaultRuntimeKind);
  if (!parsed.success) {
    throw new HostValidationError({
      message: "defaultRuntimeKind must be a supported runtime kind.",
      field: "defaultRuntimeKind",
      cause: parsed.error,
    });
  }
  return parsed.data;
};

const parseRepoConfigInput = (
  result: z.ZodSafeParseResult<WorkspaceRepoConfigInput>,
): WorkspaceRepoConfigInput => {
  if (result.success) return result.data;
  throw new HostValidationError({
    message: `workspace_update_repo_config config is invalid: ${result.error.message}`,
    field: "config",
    cause: result.error,
  });
};

const parseRepoSettingsInput = (
  result: z.ZodSafeParseResult<WorkspaceRepoSettingsInput>,
): WorkspaceRepoSettingsInput => {
  if (result.success) return result.data;
  throw new HostValidationError({
    message: `workspace_save_repo_settings settings is invalid: ${result.error.message}`,
    field: "settings",
    cause: result.error,
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
) =>
  ({
    workspace_list: (args) => {
      requireNoArgs("workspace_list", args);
      return workspaceSettingsService.listWorkspaces();
    },
    workspace_add: (args) => {
      const record = requireRecord(commandInputRecordSchema.safeParse(args), "workspace_add input");
      const defaultRuntimeKind = optionalRuntimeKind(record);
      const input: Parameters<typeof workspaceSettingsService.addWorkspace>[0] = {
        workspaceId: requireString(
          commandInputStringSchema.safeParse(record.workspaceId),
          "workspaceId",
        ),
        workspaceName: requireString(
          commandInputStringSchema.safeParse(record.workspaceName),
          "workspaceName",
        ),
        repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
      };
      if (defaultRuntimeKind) {
        input.defaultRuntimeKind = defaultRuntimeKind;
      }
      return workspaceSettingsService.addWorkspace(input);
    },
    workspace_select: (args) =>
      workspaceSettingsService.selectWorkspace(
        requireString(
          commandInputStringSchema.safeParse(
            requireObjectArgs("workspace_select", args, "workspaceId").workspaceId,
          ),
          "workspaceId",
        ),
      ),
    workspace_reorder: (args) => {
      const workspaceOrder = requireObjectArgs(
        "workspace_reorder",
        args,
        "workspaceOrder",
      ).workspaceOrder;
      return workspaceSettingsService.reorderWorkspaces(
        requireStringArray(commandInputArraySchema.safeParse(workspaceOrder), "workspaceOrder"),
      );
    },
    workspace_get_repo_config: (args) =>
      workspaceSettingsService.getRepoConfig(
        requireString(
          commandInputStringSchema.safeParse(
            requireObjectArgs("workspace_get_repo_config", args, "workspaceId").workspaceId,
          ),
          "workspaceId",
        ),
      ),
    workspace_update_repo_config: (args) =>
      workspaceSettingsService.updateRepoConfig(
        requireString(
          commandInputStringSchema.safeParse(
            requireObjectArgs("workspace_update_repo_config", args, "workspaceId").workspaceId,
          ),
          "workspaceId",
        ),
        parseRepoConfigInput(
          workspaceRepoConfigInputSchema.safeParse(
            requireObjectArgs("workspace_update_repo_config", args, "config").config,
          ),
        ),
      ),
    workspace_save_repo_settings: (args) =>
      workspaceSettingsService.saveRepoSettings(
        requireString(
          commandInputStringSchema.safeParse(
            requireObjectArgs("workspace_save_repo_settings", args, "workspaceId").workspaceId,
          ),
          "workspaceId",
        ),
        parseRepoSettingsInput(
          workspaceRepoSettingsInputSchema.safeParse(
            requireObjectArgs("workspace_save_repo_settings", args, "settings").settings,
          ),
        ),
      ),
    workspace_update_repo_hooks: (args) =>
      workspaceSettingsService.updateRepoHooks(
        requireString(
          commandInputStringSchema.safeParse(
            requireObjectArgs("workspace_update_repo_hooks", args, "workspaceId").workspaceId,
          ),
          "workspaceId",
        ),
        repoHooksSchema.parse(
          requireObjectArgs("workspace_update_repo_hooks", args, "hooks").hooks,
        ),
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
  }) satisfies HostCommandHandlerDefinitions;
