import {
  workspaceLifecycleTargetInputSchema,
  workspaceRemovalInputSchema,
  workspaceResolvePathInputSchema,
} from "@openducktor/contracts";
import type { z } from "zod";
import type { WorkspaceLifecycleService } from "../../application/workspaces/workspace-lifecycle-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { commandInputRecordSchema, type HostCommandArgs, requireRecord } from "./command-inputs";

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

const parseInput = <T>(command: string, schema: z.ZodType<T>, args: HostCommandArgs): T => {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new HostValidationError({
      message: `${command} input is invalid: ${parsed.error.message}`,
      field: "args",
      cause: parsed.error,
    });
  }
  return parsed.data;
};

export const createWorkspaceLifecycleCommandHandlers = (
  workspaceSettingsService: Pick<
    WorkspaceSettingsService,
    "getWorkspaceCatalog" | "reopenWorkspace" | "resolveWorkspacePath"
  >,
  lifecycleService: Pick<
    WorkspaceLifecycleService,
    "closeWorkspace" | "reopenWorkspace" | "removeWorkspace"
  >,
) =>
  ({
    workspace_catalog_get: (args) => {
      requireNoArgs("workspace_catalog_get", args);
      return workspaceSettingsService.getWorkspaceCatalog();
    },
    workspace_resolve_path: (args) =>
      workspaceSettingsService.resolveWorkspacePath(
        parseInput("workspace_resolve_path", workspaceResolvePathInputSchema, args).repoPath,
      ),
    workspace_close: (args) =>
      lifecycleService.closeWorkspace(
        parseInput("workspace_close", workspaceLifecycleTargetInputSchema, args),
      ),
    workspace_reopen: (args) =>
      lifecycleService.reopenWorkspace(
        parseInput("workspace_reopen", workspaceLifecycleTargetInputSchema, args),
      ),
    workspace_remove: (args) =>
      lifecycleService.removeWorkspace(
        parseInput("workspace_remove", workspaceRemovalInputSchema, args),
      ),
  }) satisfies HostCommandHandlerDefinitions;
