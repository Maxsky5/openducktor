import { workspaceTextFileWriteInputSchema } from "@openducktor/contracts";
import type { WorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import { WorkspaceTextFileWriteError } from "../../application/filesystem/workspace-text-file-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { optionalString, requireRecord, requireStringPreservingWhitespace } from "./command-inputs";

const parseListTreeInput = (
  args: Record<string, unknown> | undefined,
): { rootPath: string; targetBranch?: string } => {
  const record = requireRecord(args, "filesystem_list_tree input");
  const targetBranch = optionalString(record.targetBranch, "targetBranch");
  return {
    rootPath: requireStringPreservingWhitespace(record.rootPath, "rootPath"),
    ...(targetBranch ? { targetBranch } : {}),
  };
};

const parseReadTextFileInput = (
  args: Record<string, unknown> | undefined,
): { rootPath: string; relativePath: string } => {
  const record = requireRecord(args, "filesystem_read_text_file input");
  return {
    rootPath: requireStringPreservingWhitespace(record.rootPath, "rootPath"),
    relativePath: requireStringPreservingWhitespace(record.relativePath, "relativePath"),
  };
};

const parseWriteTextFileInput = (args: Record<string, unknown> | undefined) => {
  const result = workspaceTextFileWriteInputSchema.safeParse(args);
  if (result.success) return result.data;
  const record = args ?? {};
  const message = "The workspace text file write input is invalid.";
  throw new WorkspaceTextFileWriteError({
    message,
    failure: {
      code: "invalid_input",
      message,
      rootPath: typeof record.rootPath === "string" && record.rootPath ? record.rootPath : ".",
      relativePath:
        typeof record.relativePath === "string" && record.relativePath
          ? record.relativePath
          : "unknown",
    },
    cause: result.error,
  });
};

export const createWorkspaceFilesCommandHandlers = (
  workspaceFilesService: WorkspaceFilesService,
): HostCommandHandlers => ({
  filesystem_list_tree: (args) => workspaceFilesService.listTree(parseListTreeInput(args)),
  filesystem_read_text_file: (args) =>
    workspaceFilesService.readTextFile(parseReadTextFileInput(args)),
  filesystem_write_text_file: (args) =>
    workspaceFilesService.writeTextFile(parseWriteTextFileInput(args)),
});
