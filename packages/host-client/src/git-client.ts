import {
  type GitReadContext,
  type CommitsAheadBehind,
  commitsAheadBehindSchema,
  type FileDiff,
  type FileStatus,
  fileDiffSchema,
  fileStatusSchema,
  type GitBranch,
  type GitChangeSelectionRequest,
  type GitChangeSelectionResult,
  type GitCommitAllRequest,
  type GitCommitStagedRequest,
  type GitCommitAllResult,
  type GitConflictAbortRequest,
  type GitConflictAbortResult,
  type GitConflictOperation,
  type GitCurrentBranch,
  type GitComparisonTarget,
  type GitTargetBranch,
  gitComparisonTargetSchema,
  type GitFetchRemoteRequest,
  type GitFetchRemoteResult,
  type GitHistoryPage,
  type GitHistoryPageRequest,
  type GitLocalChanges,
  type GitPullBranchRequest,
  type GitPullBranchResult,
  type GitPushBranchResult,
  type GitRebaseAbortRequest,
  type GitRebaseAbortResult,
  type GitRebaseBranchRequest,
  type GitRebaseBranchResult,
  type GitWorktreeStatus,
  type GitWorktreeSummary,
  gitBranchSchema,
  gitChangeSelectionRequestSchema,
  gitChangeSelectionResultSchema,
  gitCommitAllResultSchema,
  gitCommitStagedRequestSchema,
  gitConflictAbortResultSchema,
  gitCurrentBranchSchema,
  gitDiffScopeSchema,
  gitFetchRemoteResultSchema,
  gitHistoryPageRequestSchema,
  gitHistoryPageSchema,
  gitLocalChangesSchema,
  gitPullBranchResultSchema,
  gitPushBranchResultSchema,
  gitRebaseAbortResultSchema,
  gitRebaseBranchResultSchema,
  gitWorktreeStatusSchema,
  gitWorktreeSummarySchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { arrayResultSchema, okResultSchema } from "./invoke-utils";
import { z } from "zod";

const canonicalPathSchema = z.string().min(1);

const gitGetBranches = async (invokeFn: InvokeFn, repoPath: string): Promise<GitBranch[]> => {
  return invokeFn(
    "git_get_branches",
    { repoPath },
    arrayResultSchema(gitBranchSchema, "git_get_branches"),
  );
};

type DirectoryReadArgs = {
  repoPath: string;
  workingDir: string | null;
  readContext?: GitReadContext;
};

const gitGetCurrentBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
  readContext?: GitReadContext,
): Promise<GitCurrentBranch> => {
  const args: DirectoryReadArgs = { repoPath, workingDir: workingDir ?? null };
  if (readContext) args.readContext = readContext;
  return invokeFn("git_get_current_branch", args, gitCurrentBranchSchema);
};

const gitSwitchBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  branch: string,
  options?: { create?: boolean },
): Promise<GitCurrentBranch> => {
  return invokeFn(
    "git_switch_branch",
    { repoPath, branch, create: options?.create ?? false },
    gitCurrentBranchSchema,
  );
};

const gitCreateWorktree = async (
  invokeFn: InvokeFn,
  repoPath: string,
  worktreePath: string,
  branch: string,
  options?: { createBranch?: boolean },
): Promise<GitWorktreeSummary> => {
  return invokeFn(
    "git_create_worktree",
    { repoPath, worktreePath, branch, createBranch: options?.createBranch ?? false },
    gitWorktreeSummarySchema,
  );
};

const gitRemoveWorktree = async (
  invokeFn: InvokeFn,
  repoPath: string,
  worktreePath: string,
  options?: { force?: boolean },
): Promise<{ ok: boolean }> => {
  return invokeFn(
    "git_remove_worktree",
    { repoPath, worktreePath, force: options?.force ?? false },
    okResultSchema("git_remove_worktree"),
  );
};

const gitPushBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  branch: string,
  options?: {
    remote?: string;
    setUpstream?: boolean;
    forceWithLease?: boolean;
    workingDir?: string;
  },
): Promise<GitPushBranchResult> => {
  return invokeFn(
    "git_push_branch",
    {
      repoPath,
      branch,
      remote: options?.remote,
      setUpstream: options?.setUpstream ?? false,
      forceWithLease: options?.forceWithLease ?? false,
      workingDir: options?.workingDir ?? null,
    },
    gitPushBranchResultSchema,
  );
};

const gitPullBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
): Promise<GitPullBranchResult> => {
  const request: GitPullBranchRequest = {
    repoPath,
    workingDir,
  };
  return invokeFn(
    "git_pull_branch",
    { repoPath: request.repoPath, workingDir: request.workingDir ?? null },
    gitPullBranchResultSchema,
  );
};

const gitFetchRemote = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  workingDir?: string,
): Promise<GitFetchRemoteResult> => {
  const request: GitFetchRemoteRequest = {
    repoPath,
    targetBranch,
    workingDir,
  };
  return invokeFn(
    "git_fetch_remote",
    {
      repoPath: request.repoPath,
      targetBranch: request.targetBranch,
      workingDir: request.workingDir ?? null,
    },
    gitFetchRemoteResultSchema,
  );
};

const gitGetStatus = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
): Promise<FileStatus[]> => {
  return invokeFn(
    "git_get_status",
    { repoPath, workingDir: workingDir ?? null },
    arrayResultSchema(fileStatusSchema, "git_get_status"),
  );
};

const gitGetDiff = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch?: string,
  workingDir?: string,
): Promise<FileDiff[]> => {
  return invokeFn(
    "git_get_diff",
    { repoPath, targetBranch: targetBranch ?? null, workingDir: workingDir ?? null },
    arrayResultSchema(fileDiffSchema, "git_get_diff"),
  );
};

const gitCommitsAheadBehind = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  workingDir?: string,
): Promise<CommitsAheadBehind> => {
  return invokeFn(
    "git_commits_ahead_behind",
    { repoPath, targetBranch, workingDir: workingDir ?? null },
    commitsAheadBehindSchema,
  );
};

type WorktreeStatusReadArgs = {
  repoPath: string;
  targetBranch: string;
  diffScope: "target" | "uncommitted";
  workingDir: string | null;
  readContext?: GitReadContext;
};
const gitGetWorktreeStatus = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  diffScope?: "target" | "uncommitted",
  workingDir?: string,
  readContext?: GitReadContext,
): Promise<GitWorktreeStatus> => {
  const args: WorktreeStatusReadArgs = {
    repoPath,
    targetBranch,
    diffScope: gitDiffScopeSchema.parse(diffScope ?? "target"),
    workingDir: workingDir ?? null,
  };
  if (readContext) args.readContext = readContext;
  return invokeFn("git_get_worktree_status", args, gitWorktreeStatusSchema);
};

type CommitAllArgs = {
  repoPath: string;
  workingDir: string | null;
  message: string;
  expectedBranch?: GitCurrentBranch;
};

const gitCommitAll = async (
  invokeFn: InvokeFn,
  repoPath: string,
  message: string,
  workingDir?: string,
  expectedBranch?: GitCurrentBranch,
): Promise<GitCommitAllResult> => {
  const request: GitCommitAllRequest = {
    repoPath,
    message,
    workingDir,
    expectedBranch,
  };
  const args: CommitAllArgs = {
    repoPath: request.repoPath,
    workingDir: request.workingDir ?? null,
    message: request.message,
  };
  if (request.expectedBranch) args.expectedBranch = request.expectedBranch;
  return invokeFn("git_commit_all", args, gitCommitAllResultSchema);
};

const gitGetLocalChanges = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
  readContext?: GitReadContext,
): Promise<GitLocalChanges> => {
  const args: DirectoryReadArgs = { repoPath, workingDir: workingDir ?? null };
  if (readContext) args.readContext = readContext;
  return invokeFn("git_get_local_changes", args, gitLocalChangesSchema);
};

const gitChangeSelection = async (
  invokeFn: InvokeFn,
  request: GitChangeSelectionRequest,
): Promise<GitChangeSelectionResult> => {
  const parsed = gitChangeSelectionRequestSchema.parse(request);
  return invokeFn(
    "git_change_selection",
    { ...parsed, workingDir: parsed.workingDir ?? null },
    gitChangeSelectionResultSchema,
  );
};

const gitCommitStaged = async (
  invokeFn: InvokeFn,
  request: GitCommitStagedRequest,
): Promise<GitCommitAllResult> => {
  const parsed = gitCommitStagedRequestSchema.parse(request);
  return invokeFn(
    "git_commit_staged",
    { ...parsed, workingDir: parsed.workingDir ?? null },
    gitCommitAllResultSchema,
  );
};

const gitGetHistoryPage = async (
  invokeFn: InvokeFn,
  request: GitHistoryPageRequest,
): Promise<GitHistoryPage> => {
  const parsed = gitHistoryPageRequestSchema.parse(request);
  return invokeFn(
    "git_get_history_page",
    { ...parsed, workingDir: parsed.workingDir ?? null },
    gitHistoryPageSchema,
  );
};

const gitRebaseBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  workingDir?: string,
): Promise<GitRebaseBranchResult> => {
  const request: GitRebaseBranchRequest = {
    repoPath,
    targetBranch,
    workingDir,
  };
  return invokeFn(
    "git_rebase_branch",
    {
      repoPath: request.repoPath,
      targetBranch: request.targetBranch,
      workingDir: request.workingDir ?? null,
    },
    gitRebaseBranchResultSchema,
  );
};

const gitRebaseAbort = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
): Promise<GitRebaseAbortResult> => {
  const request: GitRebaseAbortRequest = {
    repoPath,
    workingDir,
  };
  return invokeFn(
    "git_rebase_abort",
    { repoPath: request.repoPath, workingDir: request.workingDir ?? null },
    gitRebaseAbortResultSchema,
  );
};

const gitAbortConflict = async (
  invokeFn: InvokeFn,
  repoPath: string,
  operation: GitConflictOperation,
  workingDir?: string,
): Promise<GitConflictAbortResult> => {
  const request: GitConflictAbortRequest = {
    repoPath,
    operation,
    workingDir,
  };
  return invokeFn(
    "git_abort_conflict",
    {
      repoPath: request.repoPath,
      operation: request.operation,
      workingDir: request.workingDir ?? null,
    },
    gitConflictAbortResultSchema,
  );
};

export class HostGitClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async gitGetBranches(repoPath: string): Promise<GitBranch[]> {
    return gitGetBranches(this.invokeFn, repoPath);
  }

  /** A refresh ID lets the reads of one refresh share their directory checks. */
  async gitGetCurrentBranch(
    repoPath: string,
    workingDir?: string,
    readContext?: GitReadContext,
  ): Promise<GitCurrentBranch> {
    return gitGetCurrentBranch(this.invokeFn, repoPath, workingDir, readContext);
  }

  async gitGetComparisonTarget(
    repoPath: string,
    workingDir: string,
    target: GitTargetBranch,
    readContext?: GitReadContext,
  ): Promise<GitComparisonTarget> {
    const args: DirectoryReadArgs & { target: GitTargetBranch } = { repoPath, workingDir, target };
    if (readContext) args.readContext = readContext;
    return this.invokeFn("git_comparison_target_get", args, gitComparisonTargetSchema);
  }

  async gitSwitchBranch(
    repoPath: string,
    branch: string,
    options?: { create?: boolean },
  ): Promise<GitCurrentBranch> {
    return gitSwitchBranch(this.invokeFn, repoPath, branch, options);
  }

  async gitCreateWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    options?: { createBranch?: boolean },
  ): Promise<GitWorktreeSummary> {
    return gitCreateWorktree(this.invokeFn, repoPath, worktreePath, branch, options);
  }

  async gitRemoveWorktree(
    repoPath: string,
    worktreePath: string,
    options?: { force?: boolean },
  ): Promise<{ ok: boolean }> {
    return gitRemoveWorktree(this.invokeFn, repoPath, worktreePath, options);
  }

  async gitPushBranch(
    repoPath: string,
    branch: string,
    options?: {
      remote?: string;
      setUpstream?: boolean;
      forceWithLease?: boolean;
      workingDir?: string;
    },
  ): Promise<GitPushBranchResult> {
    return gitPushBranch(this.invokeFn, repoPath, branch, options);
  }

  async gitPullBranch(repoPath: string, workingDir?: string): Promise<GitPullBranchResult> {
    return gitPullBranch(this.invokeFn, repoPath, workingDir);
  }

  async gitFetchRemote(
    repoPath: string,
    targetBranch: string,
    workingDir?: string,
  ): Promise<GitFetchRemoteResult> {
    return gitFetchRemote(this.invokeFn, repoPath, targetBranch, workingDir);
  }

  async gitGetStatus(repoPath: string, workingDir?: string): Promise<FileStatus[]> {
    return gitGetStatus(this.invokeFn, repoPath, workingDir);
  }

  async gitGetDiff(
    repoPath: string,
    targetBranch?: string,
    workingDir?: string,
  ): Promise<FileDiff[]> {
    return gitGetDiff(this.invokeFn, repoPath, targetBranch, workingDir);
  }

  async gitCommitsAheadBehind(
    repoPath: string,
    targetBranch: string,
    workingDir?: string,
  ): Promise<CommitsAheadBehind> {
    return gitCommitsAheadBehind(this.invokeFn, repoPath, targetBranch, workingDir);
  }

  async gitGetWorktreeStatus(
    repoPath: string,
    targetBranch: string,
    diffScope?: "target" | "uncommitted",
    workingDir?: string,
    readContext?: GitReadContext,
  ): Promise<GitWorktreeStatus> {
    return gitGetWorktreeStatus(
      this.invokeFn,
      repoPath,
      targetBranch,
      diffScope,
      workingDir,
      readContext,
    );
  }

  async gitCommitAll(
    repoPath: string,
    message: string,
    workingDir?: string,
    expectedBranch?: GitCurrentBranch,
  ): Promise<GitCommitAllResult> {
    return gitCommitAll(this.invokeFn, repoPath, message, workingDir, expectedBranch);
  }

  async gitGetLocalChanges(
    repoPath: string,
    workingDir?: string,
    readContext?: GitReadContext,
  ): Promise<GitLocalChanges> {
    return gitGetLocalChanges(this.invokeFn, repoPath, workingDir, readContext);
  }

  async gitChangeSelection(request: GitChangeSelectionRequest): Promise<GitChangeSelectionResult> {
    return gitChangeSelection(this.invokeFn, request);
  }

  async gitCommitStaged(request: GitCommitStagedRequest): Promise<GitCommitAllResult> {
    return gitCommitStaged(this.invokeFn, request);
  }

  async gitGetHistoryPage(request: GitHistoryPageRequest): Promise<GitHistoryPage> {
    return gitGetHistoryPage(this.invokeFn, request);
  }

  async gitRebaseBranch(
    repoPath: string,
    targetBranch: string,
    workingDir?: string,
  ): Promise<GitRebaseBranchResult> {
    return gitRebaseBranch(this.invokeFn, repoPath, targetBranch, workingDir);
  }

  async gitRebaseAbort(repoPath: string, workingDir?: string): Promise<GitRebaseAbortResult> {
    return gitRebaseAbort(this.invokeFn, repoPath, workingDir);
  }

  async gitAbortConflict(
    repoPath: string,
    operation: GitConflictOperation,
    workingDir?: string,
  ): Promise<GitConflictAbortResult> {
    return gitAbortConflict(this.invokeFn, repoPath, operation, workingDir);
  }

  async gitCanonicalizePath(path: string): Promise<string> {
    return this.invokeFn("git_canonicalize_path", { repoPath: path }, canonicalPathSchema);
  }
}
