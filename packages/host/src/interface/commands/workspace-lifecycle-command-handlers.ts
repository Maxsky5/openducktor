import { Effect } from "effect";
import { z } from "zod";
import type { WorkspaceLifecycleService } from "../../application/workspaces/workspace-lifecycle-service";
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

const workspaceRemoveInputSchema = z.object({
  workspaceId: commandInputStringSchema,
  expectedRepoPath: commandInputStringSchema,
  removeTaskWorktrees: z.boolean(),
});

const requireWorkspaceTarget = (command: string, args: HostCommandArgs) => {
  const record: CommandInputRecord = requireRecord(
    commandInputRecordSchema.safeParse(args),
    `${command} input`,
  );
  return {
    workspaceId: requireString(
      commandInputStringSchema.safeParse(record.workspaceId),
      "workspaceId",
    ),
    expectedRepoPath: requireString(
      commandInputStringSchema.safeParse(record.expectedRepoPath),
      "expectedRepoPath",
    ),
  };
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
    workspace_resolve_path: (args) => {
      const record: CommandInputRecord = requireRecord(
        commandInputRecordSchema.safeParse(args),
        "workspace_resolve_path input",
      );
      return workspaceSettingsService.resolveWorkspacePath(
        requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
      );
    },
    workspace_close: (args) =>
      lifecycleService.closeWorkspace(requireWorkspaceTarget("workspace_close", args)),
    workspace_reopen: (args) =>
      lifecycleService.reopenWorkspace(requireWorkspaceTarget("workspace_reopen", args)),
    workspace_remove: (args) => {
      const parsed = workspaceRemoveInputSchema.safeParse(args);
      if (!parsed.success) {
        throw new HostValidationError({
          message: `workspace_remove input is invalid: ${parsed.error.message}`,
          field: "args",
          cause: parsed.error,
        });
      }
      return lifecycleService.removeWorkspace(parsed.data).pipe(
        Effect.map(({ catalog, result }) => ({
          catalog,
          removedWorktrees: result.removedWorktrees,
        })),
      );
    },
  }) satisfies HostCommandHandlerDefinitions;
