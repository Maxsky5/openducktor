import {
  type DirectoryListing,
  directoryListingSchema,
  type FilesystemListDirectoryInput,
  filesystemListDirectoryInputSchema,
  type WorkspaceFileTree,
  type WorkspaceTextFileReadResult,
  type WorkspaceTextFileWriteInput,
  type WorkspaceTextFileWriteResult,
  workspaceFileTreeSchema,
  workspaceTextFileReadResultSchema,
  workspaceTextFileWriteResultSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { z } from "zod";

type WorkspaceFileTreeInput = {
  rootPath: string;
  targetBranch?: string | null;
};

const workspaceFileTreeInputSchema = z.union([
  z.string().transform((rootPath): WorkspaceFileTreeInput => ({ rootPath })),
  z.object({
    rootPath: z.string(),
    targetBranch: z.string().nullable().optional(),
  }),
]);
const filesystemListDirectoryArgsSchema = z.union([
  z.string().transform((path): FilesystemListDirectoryInput => ({ path })),
  filesystemListDirectoryInputSchema,
  z.undefined(),
]);

const normalizeWorkspaceFileTreeInput = (
  input: string | WorkspaceFileTreeInput,
): WorkspaceFileTreeInput => {
  const parsed = workspaceFileTreeInputSchema.parse(input);
  const normalized: WorkspaceFileTreeInput = { rootPath: parsed.rootPath };
  if (parsed.targetBranch !== undefined) normalized.targetBranch = parsed.targetBranch;
  return normalized;
};

const filesystemListDirectory = async (
  invokeFn: InvokeFn,
  input?: string | FilesystemListDirectoryInput,
): Promise<DirectoryListing> => {
  const args = filesystemListDirectoryArgsSchema.parse(input);
  return invokeFn("filesystem_list_directory", args, directoryListingSchema);
};

const filesystemListTree = async (
  invokeFn: InvokeFn,
  input: string | WorkspaceFileTreeInput,
): Promise<WorkspaceFileTree> => {
  const treeInput = normalizeWorkspaceFileTreeInput(input);
  const args: WorkspaceFileTreeInput = {
    rootPath: treeInput.rootPath,
  };
  if (treeInput.targetBranch) args.targetBranch = treeInput.targetBranch;
  return invokeFn("filesystem_list_tree", args, workspaceFileTreeSchema);
};

const filesystemReadTextFile = async (
  invokeFn: InvokeFn,
  input: { rootPath: string; relativePath: string },
): Promise<WorkspaceTextFileReadResult> => {
  return invokeFn("filesystem_read_text_file", input, workspaceTextFileReadResultSchema);
};

const filesystemWriteTextFile = async (
  invokeFn: InvokeFn,
  input: WorkspaceTextFileWriteInput,
): Promise<WorkspaceTextFileWriteResult> => {
  return invokeFn("filesystem_write_text_file", input, workspaceTextFileWriteResultSchema);
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
