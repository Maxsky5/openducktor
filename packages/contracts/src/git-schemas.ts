import { z } from "zod";

export const workspaceRecordSchema = z.object({
  path: z.string(),
  isActive: z.boolean(),
  hasConfig: z.boolean(),
  configuredWorktreeBasePath: z.string().nullable(),
});
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

export const gitBranchSchema = z.object({
  name: z.string(),
  isCurrent: z.boolean(),
  isRemote: z.boolean(),
});
export type GitBranch = z.infer<typeof gitBranchSchema>;

export const gitCurrentBranchSchema = z.object({
  name: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  detached: z.boolean(),
});
export type GitCurrentBranch = z.infer<typeof gitCurrentBranchSchema>;

export const gitWorktreeSummarySchema = z.object({
  branch: z.string(),
  worktreePath: z.string(),
});
export type GitWorktreeSummary = z.infer<typeof gitWorktreeSummarySchema>;

export const gitPushSummarySchema = z.object({
  remote: z.string(),
  branch: z.string(),
  output: z.string(),
});
export type GitPushSummary = z.infer<typeof gitPushSummarySchema>;
