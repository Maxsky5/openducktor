import {
  type WorkspaceTextFileWriteInput,
  workspaceTextFileWriteInputSchema,
} from "@openducktor/contracts";
import type { WorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import { HostValidationError } from "../../effect/host-errors";
import { defineHostCommandHandlers } from "../router/host-command-router";
import { optionalString, requireRecord, requireStringPreservingWhitespace } from "./command-inputs";

const parseListTreeInput = (args: Record<string, unknown> | undefined) => {
  const record = requireRecord(args, "filesystem_list_tree input");
  const targetBranch = optionalString(record.targetBranch, "targetBranch");
  return {
    rootPath: requireStringPreservingWhitespace(record.rootPath, "rootPath"),
    ...(targetBranch ? { targetBranch } : undefined),
  } satisfies { rootPath: string; targetBranch?: string };
};

const parseReadTextFileInput = (args: Record<string, unknown> | undefined) => {
  const record = requireRecord(args, "filesystem_read_text_file input");
  return {
    rootPath: requireStringPreservingWhitespace(record.rootPath, "rootPath"),
    relativePath: requireStringPreservingWhitespace(record.relativePath, "relativePath"),
  } satisfies { rootPath: string; relativePath: string };
};

const parseWriteTextFileInput = (
  args: Record<string, unknown> | undefined,
): WorkspaceTextFileWriteInput => {
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
  defineHostCommandHandlers({
    filesystem_list_tree: (args) => workspaceFilesService.listTree(parseListTreeInput(args)),
    filesystem_read_text_file: (args) =>
      workspaceFilesService.readTextFile(parseReadTextFileInput(args)),
    filesystem_write_text_file: (args) =>
      workspaceFilesService.writeTextFile(parseWriteTextFileInput(args)),
  });
