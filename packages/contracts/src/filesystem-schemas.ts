import { z } from "zod";

export const directoryEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  isDirectory: z.boolean(),
  isGitRepo: z.boolean(),
});
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;

export const filesystemListDirectoryInputSchema = z.object({
  path: z.string().min(1).optional(),
  includeFiles: z.boolean().optional(),
});
export type FilesystemListDirectoryInput = z.infer<typeof filesystemListDirectoryInputSchema>;

export const directoryListingSchema = z.object({
  currentPath: z.string().min(1),
  currentPathIsGitRepo: z.boolean(),
  parentPath: z.string().nullable(),
  homePath: z.string().nullable(),
  entries: z.array(directoryEntrySchema),
});
export type DirectoryListing = z.infer<typeof directoryListingSchema>;

export const workspaceFileGitStatusSchema = z.enum([
  "added",
  "deleted",
  "modified",
  "renamed",
  "untracked",
  "ignored",
]);
export type WorkspaceFileGitStatus = z.infer<typeof workspaceFileGitStatusSchema>;

export const workspaceFileTreeEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["directory", "file"]),
  size: z.number().nonnegative().nullable(),
  mtimeMs: z.number().nonnegative().nullable(),
  gitStatus: workspaceFileGitStatusSchema.nullable(),
});
export type WorkspaceFileTreeEntry = z.infer<typeof workspaceFileTreeEntrySchema>;

export const workspaceFileTreeSchema = z.object({
  rootPath: z.string().min(1),
  entries: z.array(workspaceFileTreeEntrySchema),
});
export type WorkspaceFileTree = z.infer<typeof workspaceFileTreeSchema>;

const workspaceTextFileTextResultSchema = z.object({
  kind: z.literal("text"),
  rootPath: z.string().min(1),
  relativePath: z.string().min(1),
  contents: z.string(),
  size: z.number().nonnegative(),
  mtimeMs: z.number().nonnegative().nullable(),
  revision: z.string().min(1),
});

export const workspaceTextFileReadResultSchema = z.discriminatedUnion("kind", [
  workspaceTextFileTextResultSchema,
  z.object({
    kind: z.literal("unsupported"),
    rootPath: z.string().min(1),
    relativePath: z.string().min(1),
    reason: z.enum(["binary", "too_large"]),
    message: z.string().min(1),
    size: z.number().nonnegative(),
    mtimeMs: z.number().nonnegative().nullable(),
  }),
]);
export type WorkspaceTextFileReadResult = z.infer<typeof workspaceTextFileReadResultSchema>;

export const workspaceTextFileWriteInputSchema = z
  .object({
    rootPath: z.string().min(1),
    relativePath: z.string().min(1),
    contents: z.string(),
    revision: z.string().min(1),
  })
  .strict();
export type WorkspaceTextFileWriteInput = z.infer<typeof workspaceTextFileWriteInputSchema>;

export const workspaceTextFileWriteResultSchema = workspaceTextFileTextResultSchema.strict();
export type WorkspaceTextFileWriteResult = z.infer<typeof workspaceTextFileWriteResultSchema>;

export const workspaceTextFileWriteFailureCodeSchema = z.enum([
  "invalid_input",
  "path_escape",
  "unavailable_file",
  "unsupported_file",
  "stale_revision",
  "permission_denied",
  "io_failure",
]);
export type WorkspaceTextFileWriteFailureCode = z.infer<
  typeof workspaceTextFileWriteFailureCodeSchema
>;

export const workspaceTextFileWriteFailureSchema = z
  .object({
    code: workspaceTextFileWriteFailureCodeSchema,
    message: z.string().min(1),
    rootPath: z.string().min(1),
    relativePath: z.string().min(1),
  })
  .strict();
export type WorkspaceTextFileWriteFailure = z.infer<typeof workspaceTextFileWriteFailureSchema>;
