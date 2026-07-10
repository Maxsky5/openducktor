import type { WorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import {
  optionalString,
  requireRecord,
  requireString,
  requireStringPreservingWhitespace,
} from "./command-inputs";

const parseListTreeInput = (
  args: Record<string, unknown> | undefined,
): { rootPath: string; targetBranch?: string } => {
  const record = requireRecord(args, "filesystem_list_tree input");
  const targetBranch = optionalString(record.targetBranch, "targetBranch");
  return {
    rootPath: requireString(record.rootPath, "rootPath"),
    ...(targetBranch ? { targetBranch } : {}),
  };
};

const parseReadTextFileInput = (
  args: Record<string, unknown> | undefined,
): { rootPath: string; relativePath: string } => {
  const record = requireRecord(args, "filesystem_read_text_file input");
  return {
    rootPath: requireString(record.rootPath, "rootPath"),
    relativePath: requireStringPreservingWhitespace(record.relativePath, "relativePath"),
  };
};

export const createWorkspaceFilesCommandHandlers = (
  workspaceFilesService: WorkspaceFilesService,
): HostCommandHandlers => ({
  filesystem_list_tree: (args) => workspaceFilesService.listTree(parseListTreeInput(args)),
  filesystem_read_text_file: (args) =>
    workspaceFilesService.readTextFile(parseReadTextFileInput(args)),
});
