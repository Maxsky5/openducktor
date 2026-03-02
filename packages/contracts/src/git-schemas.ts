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

/** A single file diff entry from `GET /session/:id/diff`. */
export const fileDiffSchema = z.object({
  file: z.string(),
  type: z.string(),
  additions: z.number(),
  deletions: z.number(),
  /** Unified diff patch string (e.g., "--- a/src/main.ts\n+++ b/src/main.ts"). */
  diff: z.string(),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;

/** Git file status entry from `GET /file/status`. */
export const fileStatusSchema = z.object({
  path: z.string(),
  status: z.string(),
  staged: z.boolean(),
});
export type FileStatus = z.infer<typeof fileStatusSchema>;

/** Commits ahead/behind a reference branch (from `git rev-list --left-right`). */
export const commitsAheadBehindSchema = z.object({
  ahead: z.number(),
  behind: z.number(),
});
export type CommitsAheadBehind = z.infer<typeof commitsAheadBehindSchema>;

export const gitCommitAllRequestSchema = z.object({
  repoPath: z.string(),
  workingDir: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  message: z.string().trim().min(1),
});
export type GitCommitAllRequest = z.infer<typeof gitCommitAllRequestSchema>;

export const gitCommitAllResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("committed"),
    commitHash: z.string(),
    output: z.string(),
  }),
  z.object({
    outcome: z.literal("no_changes"),
    output: z.string(),
  }),
]);
export type GitCommitAllResult = z.infer<typeof gitCommitAllResultSchema>;

export const gitRebaseBranchRequestSchema = z.object({
  repoPath: z.string(),
  workingDir: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  targetBranch: z.string(),
});
export type GitRebaseBranchRequest = z.infer<typeof gitRebaseBranchRequestSchema>;

export const gitRebaseBranchResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("rebased"),
    output: z.string(),
  }),
  z.object({
    outcome: z.literal("up_to_date"),
    output: z.string(),
  }),
  z.object({
    outcome: z.literal("conflicts"),
    conflictedFiles: z.array(z.string()),
    output: z.string(),
  }),
]);
export type GitRebaseBranchResult = z.infer<typeof gitRebaseBranchResultSchema>;
