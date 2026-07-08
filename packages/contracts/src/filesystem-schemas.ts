import { z } from "zod";

export const directoryEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  isDirectory: z.boolean(),
  isGitRepo: z.boolean(),
});
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;

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
  paths: z.array(z.string().min(1)),
  entries: z.array(workspaceFileTreeEntrySchema),
});
export type WorkspaceFileTree = z.infer<typeof workspaceFileTreeSchema>;

export const workspaceTextFileReadResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    rootPath: z.string().min(1),
    relativePath: z.string().min(1),
    contents: z.string(),
    size: z.number().nonnegative(),
    mtimeMs: z.number().nonnegative().nullable(),
  }),
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
