import {
  type CommitsAheadBehind,
  commitsAheadBehindSchema,
  type FileDiff,
  type FileStatus,
  fileDiffSchema,
  fileStatusSchema,
  type GitBranch,
  type GitCommitAllRequest,
  type GitCommitAllResult,
  type GitConflictAbortRequest,
  type GitConflictAbortResult,
  type GitConflictOperation,
  type GitCurrentBranch,
  type GitFetchRemoteRequest,
  type GitFetchRemoteResult,
  type GitPullBranchRequest,
  type GitPullBranchResult,
  type GitPushBranchResult,
  type GitRebaseAbortRequest,
  type GitRebaseAbortResult,
  type GitRebaseBranchRequest,
  type GitRebaseBranchResult,
  type GitResetWorktreeSelectionRequest,
  type GitResetWorktreeSelectionResult,
  type GitWorktreeStatus,
  type GitWorktreeStatusSummary,
  type GitWorktreeSummary,
  gitBranchSchema,
  gitCommitAllResultSchema,
  gitConflictAbortResultSchema,
  gitCurrentBranchSchema,
  gitDiffScopeSchema,
  gitFetchRemoteResultSchema,
  gitPullBranchResultSchema,
  gitPushBranchResultSchema,
  gitRebaseAbortResultSchema,
  gitRebaseBranchResultSchema,
  gitResetWorktreeSelectionRequestSchema,
  gitResetWorktreeSelectionResultSchema,
  gitWorktreeStatusSchema,
  gitWorktreeStatusSummarySchema,
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

const gitGetCurrentBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
): Promise<GitCurrentBranch> => {
  return invokeFn(
    "git_get_current_branch",
    { repoPath, workingDir: workingDir ?? null },
    gitCurrentBranchSchema,
  );
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

const gitGetWorktreeStatus = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  diffScope?: "target" | "uncommitted",
  workingDir?: string,
): Promise<GitWorktreeStatus> => {
  return invokeFn(
    "git_get_worktree_status",
    {
      repoPath,
      targetBranch,
      diffScope: gitDiffScopeSchema.parse(diffScope ?? "target"),
      workingDir: workingDir ?? null,
    },
    gitWorktreeStatusSchema,
  );
};

const gitGetWorktreeStatusSummary = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  diffScope?: "target" | "uncommitted",
  workingDir?: string,
): Promise<GitWorktreeStatusSummary> => {
  return invokeFn(
    "git_get_worktree_status_summary",
    {
      repoPath,
      targetBranch,
      diffScope: gitDiffScopeSchema.parse(diffScope ?? "target"),
      workingDir: workingDir ?? null,
    },
    gitWorktreeStatusSummarySchema,
  );
};

const gitCommitAll = async (
  invokeFn: InvokeFn,
  repoPath: string,
  message: string,
  workingDir?: string,
): Promise<GitCommitAllResult> => {
  const request: GitCommitAllRequest = {
    repoPath,
    message,
    workingDir,
  };
  return invokeFn(
    "git_commit_all",
    {
      repoPath: request.repoPath,
      workingDir: request.workingDir ?? null,
      message: request.message,
    },
    gitCommitAllResultSchema,
  );
};

const gitResetWorktreeSelection = async (
  invokeFn: InvokeFn,
  request: GitResetWorktreeSelectionRequest,
): Promise<GitResetWorktreeSelectionResult> => {
  const parsedRequest = gitResetWorktreeSelectionRequestSchema.parse(request);
  return invokeFn(
    "git_reset_worktree_selection",
    {
      repoPath: parsedRequest.repoPath,
      workingDir: parsedRequest.workingDir ?? null,
      targetBranch: parsedRequest.targetBranch,
      snapshot: parsedRequest.snapshot,
      selection: parsedRequest.selection,
    },
    gitResetWorktreeSelectionResultSchema,
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

  async gitGetCurrentBranch(repoPath: string, workingDir?: string): Promise<GitCurrentBranch> {
    return gitGetCurrentBranch(this.invokeFn, repoPath, workingDir);
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
  ): Promise<GitWorktreeStatus> {
    return gitGetWorktreeStatus(this.invokeFn, repoPath, targetBranch, diffScope, workingDir);
  }

  async gitGetWorktreeStatusSummary(
    repoPath: string,
    targetBranch: string,
    diffScope?: "target" | "uncommitted",
    workingDir?: string,
  ): Promise<GitWorktreeStatusSummary> {
    return gitGetWorktreeStatusSummary(
      this.invokeFn,
      repoPath,
      targetBranch,
      diffScope,
      workingDir,
    );
  }

  async gitCommitAll(
    repoPath: string,
    message: string,
    workingDir?: string,
  ): Promise<GitCommitAllResult> {
    return gitCommitAll(this.invokeFn, repoPath, message, workingDir);
  }

  async gitResetWorktreeSelection(
    request: GitResetWorktreeSelectionRequest,
  ): Promise<GitResetWorktreeSelectionResult> {
    return gitResetWorktreeSelection(this.invokeFn, request);
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
