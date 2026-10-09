import {
  workspaceFileTreeRefreshInputSchema,
  workspaceTextFileReadInputSchema,
  type WorkspaceTextFileWriteInput,
  workspaceTextFileWriteInputSchema,
} from "@openducktor/contracts";
import type { WorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import {
  commandInputOptionalStringSchema,
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  optionalString,
  requireRecord,
  requireStringPreservingWhitespace,
} from "./command-inputs";

const parseListTreeInput = (
  args: HostCommandArgs,
): Parameters<WorkspaceFilesService["listTree"]>[0] => {
  const record = requireRecord(
    commandInputRecordSchema.safeParse(args),
    "filesystem_list_tree input",
  );
  const targetBranch = optionalString(
    commandInputOptionalStringSchema.safeParse(record.targetBranch),
    "targetBranch",
  );
  const input: Parameters<WorkspaceFilesService["listTree"]>[0] = {
    rootPath: requireStringPreservingWhitespace(
      commandInputStringSchema.safeParse(record.rootPath),
      "rootPath",
    ),
  };
  if (targetBranch) {
    input.targetBranch = targetBranch;
  }
  return input;
};

const parseReadTextFileInput = (args: HostCommandArgs) => {
  const parsed = workspaceTextFileReadInputSchema.safeParse(args);
  if (!parsed.success)
    throw new HostValidationError({
      field: "filesystem_read_text_file input",
      message: `filesystem_read_text_file input is invalid: ${parsed.error.message}`,
      cause: parsed.error,
    });
  return parsed.data;
};

const parseWriteTextFileInput = (args: HostCommandArgs): WorkspaceTextFileWriteInput => {
  const parsed = workspaceTextFileWriteInputSchema.safeParse(args);
  if (parsed.success) {
    return parsed.data;
  }
  throw new HostValidationError({
    field: "filesystem_write_text_file input",
    message: `filesystem_write_text_file input is invalid: ${parsed.error.message}`,
    cause: parsed.error,
  });
};

export const createWorkspaceFilesCommandHandlers = (workspaceFilesService: WorkspaceFilesService) =>
  ({
    filesystem_refresh_tree: (args) => {
      const parsed = workspaceFileTreeRefreshInputSchema.safeParse(args);
      if (!parsed.success)
        throw new HostValidationError({
          field: "filesystem_refresh_tree input",
          message: parsed.error.message,
          cause: parsed.error,
        });
      return workspaceFilesService.refreshTree(parsed.data);
    },
    filesystem_list_tree: (args) => workspaceFilesService.listTree(parseListTreeInput(args)),
    filesystem_read_text_file: (args) =>
      workspaceFilesService.readTextFile(parseReadTextFileInput(args)),
    filesystem_write_text_file: (args) =>
      workspaceFilesService.writeTextFile(parseWriteTextFileInput(args)),
  }) satisfies HostCommandHandlerDefinitions;
