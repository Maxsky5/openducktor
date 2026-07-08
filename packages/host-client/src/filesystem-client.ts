import {
  type DirectoryListing,
  directoryListingSchema,
  type WorkspaceFileTree,
  type WorkspaceTextFileReadResult,
  workspaceFileTreeSchema,
  workspaceTextFileReadResultSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";

const filesystemListDirectory = async (
  invokeFn: InvokeFn,
  path?: string,
): Promise<DirectoryListing> => {
  const payload = await invokeFn("filesystem_list_directory", path ? { path } : undefined);
  return directoryListingSchema.parse(payload);
};

const filesystemListTree = async (
  invokeFn: InvokeFn,
  rootPath: string,
): Promise<WorkspaceFileTree> => {
  const payload = await invokeFn("filesystem_list_tree", { rootPath });
  return workspaceFileTreeSchema.parse(payload);
};

const filesystemReadTextFile = async (
  invokeFn: InvokeFn,
  input: { rootPath: string; relativePath: string },
): Promise<WorkspaceTextFileReadResult> => {
  const payload = await invokeFn("filesystem_read_text_file", input);
  return workspaceTextFileReadResultSchema.parse(payload);
};

export class HostFilesystemClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async filesystemListDirectory(path?: string): Promise<DirectoryListing> {
    return filesystemListDirectory(this.invokeFn, path);
  }

  async filesystemListTree(rootPath: string): Promise<WorkspaceFileTree> {
    return filesystemListTree(this.invokeFn, rootPath);
  }

  async filesystemReadTextFile(input: {
    rootPath: string;
    relativePath: string;
  }): Promise<WorkspaceTextFileReadResult> {
    return filesystemReadTextFile(this.invokeFn, input);
  }
}
