import { z } from "zod";

export const workspaceRecordSchema = z.object({
  path: z.string(),
  isActive: z.boolean(),
  hasConfig: z.boolean(),
  configuredWorktreeBasePath: z.string().nullable(),
  defaultWorktreeBasePath: z.string().nullable(),
  effectiveWorktreeBasePath: z.string().nullable(),
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
  revision: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type GitCurrentBranch = z.infer<typeof gitCurrentBranchSchema>;

export const gitWorktreeSummarySchema = z.object({
  branch: z.string(),
  worktreePath: z.string(),
});
export type GitWorktreeSummary = z.infer<typeof gitWorktreeSummarySchema>;

export const knownGitProviderIdValues = ["github"] as const;
export const knownGitProviderIdSchema = z.enum(knownGitProviderIdValues);
export type KnownGitProviderId = z.infer<typeof knownGitProviderIdSchema>;

export const gitProviderIdSchema = z.string().trim().min(1);
export type GitProviderId = z.infer<typeof gitProviderIdSchema>;

export const gitMergeMethodSchema = z.enum(["merge_commit", "squash", "rebase"]);
export type GitMergeMethod = z.infer<typeof gitMergeMethodSchema>;

export const gitConflictOperationSchema = z.enum([
  "rebase",
  "pull_rebase",
  "direct_merge_merge_commit",
  "direct_merge_squash",
  "direct_merge_rebase",
]);
export type GitConflictOperation = z.infer<typeof gitConflictOperationSchema>;

export const gitProviderRepositorySchema = z.object({
  host: z.string().trim().min(1).default("github.com"),
  owner: z.string().trim().min(1),
  name: z.string().trim().min(1),
});
export type GitProviderRepository = z.infer<typeof gitProviderRepositorySchema>;

export const gitTargetBranchSchema = z.object({
  remote: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  branch: z.string().trim().min(1).default("main"),
});
export type GitTargetBranch = z.infer<typeof gitTargetBranchSchema>;

export const gitProviderConfigSchema = z.object({
  enabled: z.boolean().default(false),
  repository: z.preprocess(
    (value) => (value === null ? undefined : value),
    gitProviderRepositorySchema.optional(),
  ),
  autoDetected: z.boolean().default(false),
});
export type GitProviderConfig = z.infer<typeof gitProviderConfigSchema>;

export const repoGitProviderConfigsSchema = z
  .record(z.string(), gitProviderConfigSchema)
  .default({});
export type RepoGitProviderConfigs = z.infer<typeof repoGitProviderConfigsSchema>;

export const repoGitConfigSchema = z.object({
  providers: repoGitProviderConfigsSchema,
});
export type RepoGitConfig = z.infer<typeof repoGitConfigSchema>;

export const globalGitConfigSchema = z.object({
  defaultMergeMethod: gitMergeMethodSchema.default("merge_commit"),
});
export type GlobalGitConfig = z.infer<typeof globalGitConfigSchema>;

export const gitPullRequestStateSchema = z.enum(["open", "draft", "merged", "closed_unmerged"]);
export type GitPullRequestState = z.infer<typeof gitPullRequestStateSchema>;

export const pullRequestSchema = z.object({
  providerId: gitProviderIdSchema,
  number: z.number().int().positive(),
  url: z.string().url(),
  state: gitPullRequestStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSyncedAt: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().optional(),
  ),
  mergedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  closedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type PullRequest = z.infer<typeof pullRequestSchema>;

export const taskPullRequestDetectResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("linked"),
    pullRequest: pullRequestSchema,
  }),
  z.object({
    outcome: z.literal("not_found"),
    sourceBranch: z.string().trim().min(1),
    targetBranch: z.string().trim().min(1),
  }),
]);
export type TaskPullRequestDetectResult = z.infer<typeof taskPullRequestDetectResultSchema>;

export const directMergeRecordSchema = z.object({
  method: gitMergeMethodSchema,
  sourceBranch: z.string().trim().min(1),
  targetBranch: gitTargetBranchSchema,
  mergedAt: z.string(),
});
export type DirectMergeRecord = z.infer<typeof directMergeRecordSchema>;

export const gitProviderAvailabilitySchema = z.object({
  providerId: gitProviderIdSchema,
  enabled: z.boolean(),
  available: z.boolean(),
  reason: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type GitProviderAvailability = z.infer<typeof gitProviderAvailabilitySchema>;

export const taskApprovalContextSchema = z.object({
  taskId: z.string(),
  taskStatus: z.string(),
  workingDirectory: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  sourceBranch: z.string().trim().min(1),
  targetBranch: gitTargetBranchSchema,
  publishTarget: z.preprocess(
    (value) => (value === null ? undefined : value),
    gitTargetBranchSchema.optional(),
  ),
  defaultMergeMethod: gitMergeMethodSchema,
  hasUncommittedChanges: z.boolean().default(false),
  uncommittedFileCount: z.number().int().nonnegative().default(0),
  pullRequest: z.preprocess(
    (value) => (value === null ? undefined : value),
    pullRequestSchema.optional(),
  ),
  directMerge: z.preprocess(
    (value) => (value === null ? undefined : value),
    directMergeRecordSchema.optional(),
  ),
  suggestedSquashCommitMessage: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  providers: z.array(gitProviderAvailabilitySchema).default([]),
});
export type TaskApprovalContext = z.infer<typeof taskApprovalContextSchema>;

export const gitPushBranchResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("pushed"),
    remote: z.string(),
    branch: z.string(),
    output: z.string(),
  }),
  z.object({
    outcome: z.literal("rejected_non_fast_forward"),
    remote: z.string(),
    branch: z.string(),
    output: z.string(),
  }),
]);
export type GitPushBranchResult = z.infer<typeof gitPushBranchResultSchema>;

export const gitPullBranchRequestSchema = z.object({
  repoPath: z.string(),
  workingDir: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type GitPullBranchRequest = z.infer<typeof gitPullBranchRequestSchema>;

export const gitPullBranchResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("pulled"),
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
export type GitPullBranchResult = z.infer<typeof gitPullBranchResultSchema>;

export const gitConflictSchema = z.object({
  operation: gitConflictOperationSchema,
  currentBranch: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  targetBranch: z.string().trim().min(1),
  conflictedFiles: z.array(z.string()).default([]),
  output: z.string(),
  workingDir: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type GitConflict = z.infer<typeof gitConflictSchema>;

export const gitConflictAbortRequestSchema = z.object({
  repoPath: z.string(),
  operation: gitConflictOperationSchema,
  workingDir: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type GitConflictAbortRequest = z.infer<typeof gitConflictAbortRequestSchema>;

export const gitConflictAbortResultSchema = z.object({
  output: z.string(),
});
export type GitConflictAbortResult = z.infer<typeof gitConflictAbortResultSchema>;

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

export const gitFileStatusCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  staged: z.number().int().nonnegative(),
  unstaged: z.number().int().nonnegative(),
});
export type GitFileStatusCounts = z.infer<typeof gitFileStatusCountsSchema>;

/** Commits ahead/behind a reference branch (from `git rev-list --left-right`). */
export const commitsAheadBehindSchema = z.object({
  ahead: z.number(),
  behind: z.number(),
});
export type CommitsAheadBehind = z.infer<typeof commitsAheadBehindSchema>;

export const gitDiffScopeSchema = z.enum(["target", "uncommitted"]);
export type GitDiffScope = z.infer<typeof gitDiffScopeSchema>;

export const gitUpstreamAheadBehindSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("tracking"),
    ahead: z.number(),
    behind: z.number(),
  }),
  z.object({
    outcome: z.literal("untracked"),
    ahead: z.number(),
  }),
  z.object({
    outcome: z.literal("error"),
    message: z.string(),
  }),
]);
export type GitUpstreamAheadBehind = z.infer<typeof gitUpstreamAheadBehindSchema>;

export const gitWorktreeStatusSnapshotSchema = z.object({
  effectiveWorkingDir: z.string(),
  targetBranch: z.string(),
  diffScope: gitDiffScopeSchema,
  observedAtMs: z.number(),
  hashVersion: z.number().int().positive(),
  statusHash: z.string().regex(/^[0-9a-f]{16}$/),
  diffHash: z.string().regex(/^[0-9a-f]{16}$/),
});
export type GitWorktreeStatusSnapshot = z.infer<typeof gitWorktreeStatusSnapshotSchema>;

export const gitWorktreeStatusSchema = z.object({
  currentBranch: gitCurrentBranchSchema,
  fileStatuses: z.array(fileStatusSchema),
  fileDiffs: z.array(fileDiffSchema),
  targetAheadBehind: commitsAheadBehindSchema,
  upstreamAheadBehind: gitUpstreamAheadBehindSchema,
  snapshot: gitWorktreeStatusSnapshotSchema,
});
export type GitWorktreeStatus = z.infer<typeof gitWorktreeStatusSchema>;

export const gitWorktreeStatusSummarySchema = z.object({
  currentBranch: gitCurrentBranchSchema,
  fileStatusCounts: gitFileStatusCountsSchema,
  targetAheadBehind: commitsAheadBehindSchema,
  upstreamAheadBehind: gitUpstreamAheadBehindSchema,
  snapshot: gitWorktreeStatusSnapshotSchema,
});
export type GitWorktreeStatusSummary = z.infer<typeof gitWorktreeStatusSummarySchema>;

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

export const gitRebaseAbortRequestSchema = z.object({
  repoPath: z.string(),
  workingDir: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type GitRebaseAbortRequest = z.infer<typeof gitRebaseAbortRequestSchema>;

export const gitRebaseAbortResultSchema = z.object({
  outcome: z.literal("aborted"),
  output: z.string(),
});
export type GitRebaseAbortResult = z.infer<typeof gitRebaseAbortResultSchema>;
