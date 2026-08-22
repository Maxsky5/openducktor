import type { WorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import { optionalString, requireRecord, requireStringPreservingWhitespace } from "./command-inputs";
import type { JsonValue } from "@openducktor/contracts";

const parseListTreeInput = (args: Record<string, JsonValue> | undefined) => {
  const record = requireRecord(args, "filesystem_list_tree input");
  const targetBranch = optionalString(record.targetBranch, "targetBranch");
  return {
    rootPath: requireStringPreservingWhitespace(record.rootPath, "rootPath"),
    ...(() => {
      if (targetBranch) {
        return { targetBranch };
      }
      return {};
    })(),
  } satisfies { rootPath: string; targetBranch?: string };
};

const parseReadTextFileInput = (args: Record<string, JsonValue> | undefined) => {
  const record = requireRecord(args, "filesystem_read_text_file input");
  return {
    rootPath: requireStringPreservingWhitespace(record.rootPath, "rootPath"),
    relativePath: requireStringPreservingWhitespace(record.relativePath, "relativePath"),
  } satisfies { rootPath: string; relativePath: string };
};

export const createWorkspaceFilesCommandHandlers = (
  workspaceFilesService: WorkspaceFilesService,
): HostCommandHandlers => ({
  filesystem_list_tree: (args) => workspaceFilesService.listTree(parseListTreeInput(args)),
  filesystem_read_text_file: (args) =>
    workspaceFilesService.readTextFile(parseReadTextFileInput(args)),
  filesystem_write_text_file: (args) => workspaceFilesService.writeTextFile(args),
});
