import { z } from "zod";
import {
  azureDevOpsProviderSettingsSchema,
  azureDevOpsRepositorySchema,
  validateAzureDevOpsProviderSettings,
} from "./azure-devops-schemas";
import {
  workspaceAbbreviationValueSchema,
  workspaceTileColorValueSchema,
} from "./workspace-identity-schemas";

export const workspaceRecordSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  abbreviation: workspaceAbbreviationValueSchema.nullable(),
  tileColor: workspaceTileColorValueSchema.nullable(),
  repoPath: z.string(),
  iconDataUrl: z.string().nullable().optional(),
  isActive: z.boolean(),
  hasConfig: z.boolean(),
  configuredWorktreeBasePath: z.string().nullable(),
  defaultWorktreeBasePath: z.string().nullable(),
  effectiveWorktreeBasePath: z.string().nullable(),
});
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

// Refresh IDs identify one logical read, not permission or Query identity.
export const gitReadContextSchema = z.object({ refreshId: z.string().min(1).max(128) }).strict();
export type GitReadContext = z.infer<typeof gitReadContextSchema>;

export const gitBranchSchema = z.object({
  worktreePath: z.string().min(1).optional(),
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

export const knownGitProviderIdValues = ["github", "azure_devops"] as const;
export const knownGitProviderIdSchema = z.enum(knownGitProviderIdValues);
export type KnownGitProviderId = z.infer<typeof knownGitProviderIdSchema>;

export const gitProviderIdSchema = z.string().trim().min(1);
export type GitProviderId = z.infer<typeof gitProviderIdSchema>;

export const gitProviderCapabilitiesSchema = z
  .object({
    supportsPullRequests: z.boolean(),
    supportsPullRequestReview: z.boolean(),
    issueAccess: z.enum(["browse", "search"]).optional(),
  })
  .strict()
  .superRefine((capabilities, context) => {
    if (capabilities.supportsPullRequestReview && !capabilities.supportsPullRequests) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pull Request review support requires Pull Request support.",
        path: ["supportsPullRequestReview"],
      });
    }
  });
export type GitProviderCapabilities = z.infer<typeof gitProviderCapabilitiesSchema>;

export const gitProviderDescriptorSchema = z
  .object({
    id: gitProviderIdSchema,
    label: z.string().trim().min(1),
    description: z.string().trim().min(1),
    capabilities: gitProviderCapabilitiesSchema,
  })
  .strict();
export type GitProviderDescriptor = z.infer<typeof gitProviderDescriptorSchema>;

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

export const githubGitProviderRepositorySchema = z.object({
  host: z.string().trim().min(1).default("github.com"),
  owner: z.string().trim().min(1),
  name: z.string().trim().min(1),
});
export type GithubGitProviderRepository = z.infer<typeof githubGitProviderRepositorySchema>;

export const gitProviderRepositorySchema = z.union([
  azureDevOpsRepositorySchema,
  githubGitProviderRepositorySchema,
]);
export type GitProviderRepository = z.infer<typeof gitProviderRepositorySchema>;

export const gitTargetBranchSchema = z.object({
  remote: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  branch: z.string().trim().min(1).default("main"),
});
export type GitTargetBranch = z.infer<typeof gitTargetBranchSchema>;

export const gitComparisonTargetSchema = z.union([
  z.object({ kind: z.literal("available"), reference: z.string().min(1) }),
  z.object({ kind: z.literal("unavailable"), reason: z.string().min(1) }),
]);
export type GitComparisonTarget = z.infer<typeof gitComparisonTargetSchema>;

export const gitProviderConfigSchema = z
  .object({
    id: gitProviderIdSchema,
    enabled: z.boolean().default(false),
    repository: z.preprocess(
      (value) => (value === null ? undefined : value),
      gitProviderRepositorySchema.optional(),
    ),
    autoDetected: z.boolean().default(false),
    settings: azureDevOpsProviderSettingsSchema.optional(),
  })
  .strict()
  .superRefine((config, context) => {
    const azureRepository =
      config.repository && "providerId" in config.repository ? config.repository : undefined;
    const issue = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: z.ZodIssueCode.custom, message, path });
    };
    if (config.id === "azure_devops") {
      if (config.repository && !azureRepository) {
        issue(["repository"], "Azure DevOps provider settings require an Azure DevOps repository.");
      }
      validateAzureDevOpsProviderSettings(azureRepository, config.settings, context);
      return;
    }

    if (azureRepository) {
      issue(["repository"], "Only the Azure DevOps provider can use an Azure DevOps repository.");
    }
    if (config.settings !== undefined) {
      issue(["settings"], "Only the Azure DevOps provider can use Azure DevOps settings.");
    }
  });
export type GitProviderConfig = z.infer<typeof gitProviderConfigSchema>;

export const repoGitConfigSchema = z
  .object({
    provider: gitProviderConfigSchema.optional(),
  })
  .strict();
export type RepoGitConfig = z.infer<typeof repoGitConfigSchema>;

export const globalGitConfigSchema = z.object({
  defaultMergeMethod: gitMergeMethodSchema.default("merge_commit"),
});
export type GlobalGitConfig = z.infer<typeof globalGitConfigSchema>;

export const gitPullRequestStateSchema = z.enum(["open", "draft", "merged", "closed_unmerged"]);
export type GitPullRequestState = z.infer<typeof gitPullRequestStateSchema>;

export const pullRequestSchema = z.object({
  providerId: gitProviderIdSchema,
  repositoryIdentity: z.string().trim().min(1).optional(),
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

export const sourceIssueReferenceSchema = z.object({
  providerId: gitProviderIdSchema,
  scope: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  number: z.string().trim().min(1),
  url: z.string().url(),
});
export type SourceIssueReference = z.infer<typeof sourceIssueReferenceSchema>;

export const taskPullRequestDetectResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("linked"),
    pullRequest: pullRequestSchema,
  }),
  z.object({
    outcome: z.literal("merged"),
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

export const gitProviderHealthSchema = gitProviderAvailabilitySchema.extend({
  executablePath: z.string().nullable(),
  version: z.string().nullable(),
  authenticated: z.boolean(),
  account: z.string().nullable(),
  repositoryMappingValid: z.boolean().nullable(),
});
export type GitProviderHealth = z.infer<typeof gitProviderHealthSchema>;

export const repositoryGitProviderContextSchema = z
  .object({
    descriptor: gitProviderDescriptorSchema,
    config: gitProviderConfigSchema,
    health: gitProviderHealthSchema,
  })
  .strict()
  .superRefine((provider, context) => {
    if (provider.config.id !== provider.descriptor.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Configured provider id must match the descriptor id.",
        path: ["config", "id"],
      });
    }
    if (provider.health.providerId !== provider.descriptor.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Health provider id must match the descriptor id.",
        path: ["health", "providerId"],
      });
    }
    if (provider.health.enabled !== provider.config.enabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Health and configuration must use the same enabled value.",
        path: ["health", "enabled"],
      });
    }
  })
  .nullable();
export type RepositoryGitProviderContext = z.infer<typeof repositoryGitProviderContextSchema>;

export const gitPublicationPreviewSchema = z.strictObject({
  sourceOid: z.string().regex(/^[a-f0-9]{40,64}$/),
  remote: z.string().min(1),
  targetRef: z.string().startsWith("refs/heads/"),
  destinations: z
    .array(z.strictObject({ identity: z.string().min(1), label: z.string().min(1) }))
    .min(1),
});
export type GitPublicationPreview = z.infer<typeof gitPublicationPreviewSchema>;
export const taskDirectMergeCompleteIntentSchema = z.strictObject({
  repoPath: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  publicationConsent: z
    .strictObject({
      expectedMerge: directMergeRecordSchema,
      expectedPublication: gitPublicationPreviewSchema,
    })
    .optional(),
});
export type TaskDirectMergeCompleteIntent = z.infer<typeof taskDirectMergeCompleteIntentSchema>;

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
  publicationPreview: gitPublicationPreviewSchema.optional(),
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
});
export type TaskApprovalContext = z.infer<typeof taskApprovalContextSchema>;

export const taskApprovalContextLoadResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("ready"),
    approvalContext: taskApprovalContextSchema,
  }),
  z.object({
    outcome: z.literal("missing_builder_worktree"),
    taskId: z.string(),
    taskStatus: z.string(),
  }),
]);
export type TaskApprovalContextLoadResult = z.infer<typeof taskApprovalContextLoadResultSchema>;

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

export const gitFetchRemoteRequestSchema = z.object({
  repoPath: z.string(),
  targetBranch: z.string().trim().min(1),
  workingDir: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type GitFetchRemoteRequest = z.infer<typeof gitFetchRemoteRequestSchema>;

export const gitFetchRemoteResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("fetched"),
    output: z.string(),
  }),
  z.object({
    outcome: z.literal("skipped_no_remote"),
    output: z.string(),
  }),
]);
export type GitFetchRemoteResult = z.infer<typeof gitFetchRemoteResultSchema>;

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

/** A single structured file diff entry emitted by runtime adapters or diff endpoints. */
export const fileDiffSchema = z.object({
  file: z.string(),
  type: z.string(),
  additions: z.number(),
  deletions: z.number(),
  /** Unified diff patch string (e.g., "--- a/src/main.ts\n+++ b/src/main.ts"). */
  diff: z.string(),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;

/**
 * The kind of a Git file change. Runtime file edits keep the open `FileDiff` type, because
 * runtimes report them, but Git snapshots use only these kinds.
 */
export const gitFileDiffTypeSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "submodule",
]);
export type GitFileDiffType = z.infer<typeof gitFileDiffTypeSchema>;

/** A file change in a Git snapshot, such as local changes or Branch changes. */
export const gitFileDiffSchema = fileDiffSchema.extend({ type: gitFileDiffTypeSchema });
export type GitFileDiff = z.infer<typeof gitFileDiffSchema>;

/** Full file content emitted by runtime adapters when the tool contract has no diff. */
export const fileContentSchema = z.object({
  file: z.string(),
  type: z.string(),
  content: z.string(),
});
export type FileContent = z.infer<typeof fileContentSchema>;

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
  fileDiffs: z.array(gitFileDiffSchema),
  targetAheadBehind: commitsAheadBehindSchema,
  upstreamAheadBehind: gitUpstreamAheadBehindSchema,
  gitConflict: z.preprocess(
    (value) => (value === null ? undefined : value),
    gitConflictSchema.optional(),
  ),
  snapshot: gitWorktreeStatusSnapshotSchema,
});
export type GitWorktreeStatus = z.infer<typeof gitWorktreeStatusSchema>;

export const gitWorktreeStatusSummarySchema = z.object({
  currentBranch: gitCurrentBranchSchema,
  fileStatusCounts: gitFileStatusCountsSchema,
  targetAheadBehind: commitsAheadBehindSchema,
  upstreamAheadBehind: gitUpstreamAheadBehindSchema,
  gitConflict: z.preprocess(
    (value) => (value === null ? undefined : value),
    gitConflictSchema.optional(),
  ),
  snapshot: gitWorktreeStatusSnapshotSchema,
});
export type GitWorktreeStatusSummary = z.infer<typeof gitWorktreeStatusSummarySchema>;

export const gitResetSnapshotSchema = z.object({
  hashVersion: z.number().int().positive(),
  statusHash: z.string().regex(/^[0-9a-f]{16}$/),
  diffHash: z.string().regex(/^[0-9a-f]{16}$/),
});
export type GitResetSnapshot = z.infer<typeof gitResetSnapshotSchema>;

export const gitResetWorktreeSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    filePath: z.string(),
  }),
  z.object({
    kind: z.literal("hunk"),
    filePath: z.string(),
    hunkIndex: z.number().int().nonnegative(),
  }),
]);
export type GitResetWorktreeSelection = z.infer<typeof gitResetWorktreeSelectionSchema>;

export const gitResetWorktreeSelectionRequestSchema = z.object({
  repoPath: z.string(),
  workingDir: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  targetBranch: z.string().trim().min(1),
  snapshot: gitResetSnapshotSchema,
  selection: gitResetWorktreeSelectionSchema,
});
export type GitResetWorktreeSelectionRequest = z.infer<
  typeof gitResetWorktreeSelectionRequestSchema
>;

export const gitResetWorktreeSelectionResultSchema = z.object({
  affectedPaths: z.array(z.string()).min(1),
});
export type GitResetWorktreeSelectionResult = z.infer<typeof gitResetWorktreeSelectionResultSchema>;

const optionalWorkingDirSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional(),
);

/** Staged content is HEAD to index. Unstaged content is index to working files. */
export const gitChangeGroupSchema = z.enum(["unstaged", "staged"]);
export type GitChangeGroup = z.infer<typeof gitChangeGroupSchema>;

export const gitLocalChangeGroupSchema = z.object({
  fileStatuses: z.array(fileStatusSchema),
  fileDiffs: z.array(gitFileDiffSchema),
  snapshot: gitResetSnapshotSchema,
});
export type GitLocalChangeGroup = z.infer<typeof gitLocalChangeGroupSchema>;

export const gitLocalChangesRequestSchema = z.object({
  repoPath: z.string(),
  workingDir: optionalWorkingDirSchema,
  readContext: gitReadContextSchema.optional(),
});
export type GitLocalChangesRequest = z.infer<typeof gitLocalChangesRequestSchema>;

export const gitLocalChangesSchema = z.object({
  currentBranch: gitCurrentBranchSchema,
  /** One entry for each changed path, in the shape of the HEAD worktree status. */
  fileStatuses: z.array(fileStatusSchema),
  unstaged: gitLocalChangeGroupSchema,
  staged: gitLocalChangeGroupSchema,
  /** Unresolved paths. They stay out of both groups, and their diff compares HEAD with the file. */
  conflicted: z.object({
    fileStatuses: z.array(fileStatusSchema),
    fileDiffs: z.array(gitFileDiffSchema),
  }),
  upstreamAheadBehind: gitUpstreamAheadBehindSchema,
  gitConflict: z.preprocess(
    (value) => (value === null ? undefined : value),
    gitConflictSchema.optional(),
  ),
  snapshot: gitWorktreeStatusSnapshotSchema,
});
export type GitLocalChanges = z.infer<typeof gitLocalChangesSchema>;

export const gitChangeActionSchema = z.enum(["stage", "unstage", "discard"]);
export type GitChangeAction = z.infer<typeof gitChangeActionSchema>;

export const gitChangeSelectionSchema = z.union([
  gitResetWorktreeSelectionSchema,
  z.object({ kind: z.literal("all") }),
]);
export type GitChangeSelection = z.infer<typeof gitChangeSelectionSchema>;

export const gitChangeSelectionRequestSchema = z
  .object({
    repoPath: z.string(),
    workingDir: optionalWorkingDirSchema,
    expectedBranch: gitCurrentBranchSchema,
    snapshots: z.object({
      unstaged: gitResetSnapshotSchema,
      staged: gitResetSnapshotSchema,
    }),
    action: gitChangeActionSchema,
    group: gitChangeGroupSchema,
    selection: gitChangeSelectionSchema,
  })
  .superRefine((request, context) => {
    const issue = (path: string, message: string): void => {
      context.addIssue({ code: "custom", message, path: [path] });
    };
    if (request.action === "stage" && request.group !== "unstaged") {
      issue("group", "Stage applies only to unstaged changes.");
    }
    if (request.action === "unstage" && request.group !== "staged") {
      issue("group", "Unstage applies only to staged changes.");
    }
    if (request.action === "discard" && request.selection.kind === "all") {
      issue("selection", "Discard applies to one file or one chunk.");
    }
  });
export type GitChangeSelectionRequest = z.infer<typeof gitChangeSelectionRequestSchema>;

/**
 * The paths that a change wrote, and the local changes that Git shows after it. The panel shows
 * them at once, so it needs no second read before the next change.
 */
export const gitChangeSelectionResultSchema = gitResetWorktreeSelectionResultSchema.extend({
  localChanges: gitLocalChangesSchema,
});
export type GitChangeSelectionResult = z.infer<typeof gitChangeSelectionResultSchema>;

export const gitCommitAllRequestSchema = z.object({
  repoPath: z.string(),
  workingDir: optionalWorkingDirSchema,
  message: z.string().trim().min(1),
  /** When present, the host commits only if the checkout still matches. */
  expectedBranch: gitCurrentBranchSchema.optional(),
});
export type GitCommitAllRequest = z.infer<typeof gitCommitAllRequestSchema>;

export const gitCommitStagedRequestSchema = z.object({
  repoPath: z.string(),
  workingDir: optionalWorkingDirSchema,
  message: z.string().trim().min(1),
  expectedBranch: gitCurrentBranchSchema,
  /** The staged content that the user reviewed. Other staged content fails the commit. */
  stagedSnapshot: gitResetSnapshotSchema,
});
export type GitCommitStagedRequest = z.infer<typeof gitCommitStagedRequestSchema>;

const gitObjectIdSchema = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/);

export const gitHistoryPageRequestSchema = z.object({
  repoPath: z.string(),
  workingDir: optionalWorkingDirSchema,
  targetReference: z.string().trim().min(1),
  expectedBranch: gitCurrentBranchSchema,
  /** Later pages keep the tips of the first page. */
  page: z
    .object({
      currentTip: gitObjectIdSchema,
      targetTip: gitObjectIdSchema,
      offset: z.number().int().positive(),
    })
    .optional(),
});
export type GitHistoryPageRequest = z.infer<typeof gitHistoryPageRequestSchema>;

export const gitHistoryCommitMembershipSchema = z.enum(["current", "target", "boundary"]);
export type GitHistoryCommitMembership = z.infer<typeof gitHistoryCommitMembershipSchema>;

export const gitHistoryCommitSchema = z.object({
  oid: gitObjectIdSchema,
  parentOids: z.array(gitObjectIdSchema),
  /** Parents older than the shared boundary. The graph ends these edges at the comparison limit. */
  outsideParentOids: z.array(gitObjectIdSchema),
  membership: gitHistoryCommitMembershipSchema,
  subject: z.string(),
  message: z.string(),
  authorName: z.string(),
  /** Strict ISO 8601 with the author's timezone offset. */
  authorDate: z.string().min(1),
});
export type GitHistoryCommit = z.infer<typeof gitHistoryCommitSchema>;

export const gitHistoryComparisonSchema = z.object({
  currentTip: gitObjectIdSchema,
  targetTip: gitObjectIdSchema,
  boundaryOids: z.array(gitObjectIdSchema).min(1),
  aheadBehind: commitsAheadBehindSchema,
});
export type GitHistoryComparison = z.infer<typeof gitHistoryComparisonSchema>;

export const gitHistoryPageSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("page"),
    comparison: gitHistoryComparisonSchema,
    commits: z.array(gitHistoryCommitSchema),
    /** `null` confirms that the comparison has no more commits. */
    nextOffset: z.number().int().positive().nullable(),
  }),
  z.object({ outcome: z.literal("no_commits") }),
  z.object({
    outcome: z.literal("no_common_ancestor"),
    currentTip: gitObjectIdSchema,
    targetTip: gitObjectIdSchema,
    shallow: z.boolean(),
  }),
]);
export type GitHistoryPage = z.infer<typeof gitHistoryPageSchema>;

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
