import {
  type DirectoryListing,
  directoryListingSchema,
  type FilesystemListDirectoryInput,
  type WorkspaceFileTree,
  type WorkspaceTextFileReadResult,
  type WorkspaceTextFileWriteInput,
  type WorkspaceTextFileWriteResult,
  workspaceFileTreeSchema,
  workspaceTextFileReadResultSchema,
  workspaceTextFileWriteResultSchema,
  hasRuntimeType,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";

import { toCommandArgs } from "./invoke-utils";
type WorkspaceFileTreeInput = {
  rootPath: string;
  targetBranch?: string | null;
};

const normalizeWorkspaceFileTreeInput = (
  input: string | WorkspaceFileTreeInput,
): WorkspaceFileTreeInput => (hasRuntimeType(input, "string") ? { rootPath: input } : input);

const filesystemListDirectory = async (
  invokeFn: InvokeFn,
  input?: string | FilesystemListDirectoryInput,
): Promise<DirectoryListing> => {
  const args = hasRuntimeType(input, "string") ? { path: input } : input;
  const payload = await invokeFn(
    "filesystem_list_directory",
    args === undefined ? undefined : toCommandArgs(args),
  );
  return directoryListingSchema.parse(payload);
};

const filesystemListTree = async (
  invokeFn: InvokeFn,
  input: string | WorkspaceFileTreeInput,
): Promise<WorkspaceFileTree> => {
  const treeInput = normalizeWorkspaceFileTreeInput(input);
  const payload = await invokeFn("filesystem_list_tree", {
    rootPath: treeInput.rootPath,
    ...(() => {
      if (treeInput.targetBranch) {
        return { targetBranch: treeInput.targetBranch };
      }
      return {};
    })(),
  });
  return workspaceFileTreeSchema.parse(payload);
};

const filesystemReadTextFile = async (
  invokeFn: InvokeFn,
  input: { rootPath: string; relativePath: string },
): Promise<WorkspaceTextFileReadResult> => {
  const payload = await invokeFn("filesystem_read_text_file", input);
  return workspaceTextFileReadResultSchema.parse(payload);
};

const filesystemWriteTextFile = async (
  invokeFn: InvokeFn,
  input: WorkspaceTextFileWriteInput,
): Promise<WorkspaceTextFileWriteResult> => {
  const payload = await invokeFn("filesystem_write_text_file", input);
  return workspaceTextFileWriteResultSchema.parse(payload);
};

export class HostFilesystemClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async filesystemListDirectory(
    input?: string | FilesystemListDirectoryInput,
  ): Promise<DirectoryListing> {
    return filesystemListDirectory(this.invokeFn, input);
  }

  async filesystemListTree(input: string | WorkspaceFileTreeInput): Promise<WorkspaceFileTree> {
    return filesystemListTree(this.invokeFn, input);
  }

  async filesystemReadTextFile(input: {
    rootPath: string;
    relativePath: string;
  }): Promise<WorkspaceTextFileReadResult> {
    return filesystemReadTextFile(this.invokeFn, input);
  }

  async filesystemWriteTextFile(
    input: WorkspaceTextFileWriteInput,
  ): Promise<WorkspaceTextFileWriteResult> {
    return filesystemWriteTextFile(this.invokeFn, input);
  }
}
