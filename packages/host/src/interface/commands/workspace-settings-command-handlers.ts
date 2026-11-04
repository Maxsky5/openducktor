import {
  agentModelFavoritesSchema,
  customAgentRoleInputSchema,
  kanbanTaskCardViewSchema,
  settingsSnapshotSaveInputSchema,
  sidebarSessionGroupingSchema,
  themePreferenceSchema,
  workspaceAgentStudioStateSchema,
  workspaceAgentStudioStateActionSchema,
} from "@openducktor/contracts";
import { z } from "zod";
import type { HostRuntimeService } from "../../application/runtimes/host-runtime-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { configValidationError, toPayloadValue } from "../../config/config-validation-message";
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

const requireParsedInput = <Output>(
  schema: z.ZodType<Output>,
  record: CommandInputRecord,
  key: string,
): Output => {
  const rawInput = record[key];
  const result = schema.safeParse(rawInput);
  if (!result.success) {
    throw configValidationError(result.error, toPayloadValue(rawInput));
  }

  return result.data;
};

const runtimeConfirmationSchema = z.string().trim().min(1).optional();

const parseRuntimeConfirmation = (record: CommandInputRecord): string | undefined => {
  const parsed = runtimeConfirmationSchema.safeParse(record.runtimeConfirmation);
  if (parsed.success) return parsed.data;
  throw new HostValidationError({
    message: "workspace_save_settings_snapshot runtimeConfirmation must be a string.",
    field: "runtimeConfirmation",
    cause: parsed.error,
  });
};

const parseAgentStudioStateInput = (record: CommandInputRecord) => {
  const result = workspaceAgentStudioStateSchema.safeParse(record.state);
  if (result.success) return result.data;
  throw new HostValidationError({
    message: `workspace_replace_agent_studio_state state is invalid: ${result.error.message}`,
    field: "state",
    cause: result.error,
  });
};

export const createWorkspaceSettingsCommandHandlers = (
  workspaceSettingsService: Pick<
    WorkspaceSettingsService,
    | "getRepoConfig"
    | "getSettingsSnapshot"
    | "listWorkspaces"
    | "listCustomAgentRoles"
    | "createCustomAgentRole"
    | "updateCustomAgentRole"
    | "deleteCustomAgentRole"
    | "reorderWorkspaces"
    | "replaceAgentStudioState"
    | "applyAgentStudioStateAction"
    | "selectWorkspace"
    | "setTheme"
    | "updateAgentModelFavorites"
    | "updateKanbanTaskCardView"
    | "updateSidebarSessionGrouping"
  >,
  hostRuntimeService: Pick<HostRuntimeService, "previewSettings" | "saveSettings">,
) =>
  ({
    custom_agent_role_list: (args) => {
      requireNoArgs("custom_agent_role_list", args);
      return workspaceSettingsService.listCustomAgentRoles();
    },
    custom_agent_role_create: (args) =>
      workspaceSettingsService.createCustomAgentRole(
        customAgentRoleInputSchema.parse(
          requireObjectArgs("custom_agent_role_create", args, "input").input,
        ),
      ),
    custom_agent_role_update: (args) => {
      const record = requireObjectArgs("custom_agent_role_update", args, "input");
      return workspaceSettingsService.updateCustomAgentRole(
        requireString(commandInputStringSchema.safeParse(record.id), "id"),
        customAgentRoleInputSchema.parse(record.input),
      );
    },
    custom_agent_role_delete: (args) => {
      const record = requireObjectArgs("custom_agent_role_delete", args, "id");
      return workspaceSettingsService.deleteCustomAgentRole(
        requireString(commandInputStringSchema.safeParse(record.id), "id"),
      );
    },
    workspace_list: (args) => {
      requireNoArgs("workspace_list", args);
      return workspaceSettingsService.listWorkspaces();
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
    workspace_replace_agent_studio_state: (args) => {
      const record = requireObjectArgs("workspace_replace_agent_studio_state", args, "workspaceId");
      return workspaceSettingsService.replaceAgentStudioState(
        requireString(commandInputStringSchema.safeParse(record.workspaceId), "workspaceId"),
        parseAgentStudioStateInput(
          requireObjectArgs("workspace_replace_agent_studio_state", args, "state"),
        ),
      );
    },
    workspace_apply_agent_studio_state_action: (args) => {
      const record = requireObjectArgs("workspace_apply_agent_studio_state_action", args, "action");
      return workspaceSettingsService.applyAgentStudioStateAction(
        requireString(commandInputStringSchema.safeParse(record.workspaceId), "workspaceId"),
        requireParsedInput(workspaceAgentStudioStateActionSchema, record, "action"),
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
    workspace_get_settings_snapshot: (args) => {
      requireNoArgs("workspace_get_settings_snapshot", args);
      return workspaceSettingsService.getSettingsSnapshot();
    },
    workspace_preview_settings_snapshot_runtime: (args) =>
      hostRuntimeService.previewSettings(
        requireParsedInput(
          settingsSnapshotSaveInputSchema,
          requireObjectArgs("workspace_preview_settings_snapshot_runtime", args, "snapshot"),
          "snapshot",
        ),
      ),
    workspace_save_settings_snapshot: (args) => {
      const record = requireObjectArgs("workspace_save_settings_snapshot", args, "snapshot");
      return hostRuntimeService.saveSettings({
        snapshot: requireParsedInput(settingsSnapshotSaveInputSchema, record, "snapshot"),
        runtimeConfirmation: parseRuntimeConfirmation(record),
      });
    },
    workspace_update_agent_model_favorites: (args) =>
      workspaceSettingsService.updateAgentModelFavorites(
        requireParsedInput(
          agentModelFavoritesSchema,
          requireObjectArgs("workspace_update_agent_model_favorites", args, "favorites"),
          "favorites",
        ),
      ),
    workspace_update_kanban_task_card_view: (args) =>
      workspaceSettingsService.updateKanbanTaskCardView(
        requireParsedInput(
          kanbanTaskCardViewSchema,
          requireObjectArgs("workspace_update_kanban_task_card_view", args, "taskCardView"),
          "taskCardView",
        ),
      ),
    workspace_update_sidebar_session_grouping: (args) =>
      workspaceSettingsService.updateSidebarSessionGrouping(
        requireParsedInput(
          sidebarSessionGroupingSchema,
          requireObjectArgs("workspace_update_sidebar_session_grouping", args, "grouping"),
          "grouping",
        ),
      ),
    set_theme: (args) =>
      workspaceSettingsService.setTheme(
        requireParsedInput(
          themePreferenceSchema,
          requireObjectArgs("set_theme", args, "theme"),
          "theme",
        ),
      ),
  }) satisfies HostCommandHandlerDefinitions;
