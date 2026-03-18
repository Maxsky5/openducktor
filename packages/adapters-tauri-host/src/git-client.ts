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
  type GitPullBranchRequest,
  type GitPullBranchResult,
  type GitPushBranchResult,
  type GitRebaseAbortRequest,
  type GitRebaseAbortResult,
  type GitRebaseBranchRequest,
  type GitRebaseBranchResult,
  type GitWorktreeStatus,
  type GitWorktreeStatusSummary,
  type GitWorktreeSummary,
  gitBranchSchema,
  gitCommitAllResultSchema,
  gitConflictAbortResultSchema,
  gitCurrentBranchSchema,
  gitDiffScopeSchema,
  gitPullBranchResultSchema,
  gitPushBranchResultSchema,
  gitRebaseAbortResultSchema,
  gitRebaseBranchResultSchema,
  gitWorktreeStatusSchema,
  gitWorktreeStatusSummarySchema,
  gitWorktreeSummarySchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { parseArray, parseOkResult } from "./invoke-utils";

const gitGetBranches = async (invokeFn: InvokeFn, repoPath: string): Promise<GitBranch[]> => {
  const payload = await invokeFn("git_get_branches", { repoPath });
  return parseArray(gitBranchSchema, payload, "git_get_branches");
};

const gitGetCurrentBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
): Promise<GitCurrentBranch> => {
  const payload = await invokeFn("git_get_current_branch", {
    repoPath,
    workingDir: workingDir ?? null,
  });
  return gitCurrentBranchSchema.parse(payload);
};

const gitSwitchBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  branch: string,
  options?: { create?: boolean },
): Promise<GitCurrentBranch> => {
  const payload = await invokeFn("git_switch_branch", {
    repoPath,
    branch,
    create: options?.create ?? false,
  });
  return gitCurrentBranchSchema.parse(payload);
};

const gitCreateWorktree = async (
  invokeFn: InvokeFn,
  repoPath: string,
  worktreePath: string,
  branch: string,
  options?: { createBranch?: boolean },
): Promise<GitWorktreeSummary> => {
  const payload = await invokeFn("git_create_worktree", {
    repoPath,
    worktreePath,
    branch,
    createBranch: options?.createBranch ?? false,
  });
  return gitWorktreeSummarySchema.parse(payload);
};

const gitRemoveWorktree = async (
  invokeFn: InvokeFn,
  repoPath: string,
  worktreePath: string,
  options?: { force?: boolean },
): Promise<{ ok: boolean }> => {
  const payload = await invokeFn("git_remove_worktree", {
    repoPath,
    worktreePath,
    force: options?.force ?? false,
  });
  return parseOkResult(payload, "git_remove_worktree");
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
  const payload = await invokeFn("git_push_branch", {
    repoPath,
    branch,
    remote: options?.remote,
    setUpstream: options?.setUpstream ?? false,
    forceWithLease: options?.forceWithLease ?? false,
    workingDir: options?.workingDir ?? null,
  });
  return gitPushBranchResultSchema.parse(payload);
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
  const payload = await invokeFn("git_pull_branch", {
    repoPath: request.repoPath,
    workingDir: request.workingDir ?? null,
  });
  return gitPullBranchResultSchema.parse(payload);
};

const gitGetStatus = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
): Promise<FileStatus[]> => {
  const payload = await invokeFn("git_get_status", {
    repoPath,
    workingDir: workingDir ?? null,
  });
  return parseArray(fileStatusSchema, payload, "git_get_status");
};

const gitGetDiff = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch?: string,
  workingDir?: string,
): Promise<FileDiff[]> => {
  const payload = await invokeFn("git_get_diff", {
    repoPath,
    targetBranch: targetBranch ?? null,
    workingDir: workingDir ?? null,
  });
  return parseArray(fileDiffSchema, payload, "git_get_diff");
};

const gitCommitsAheadBehind = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  workingDir?: string,
): Promise<CommitsAheadBehind> => {
  const payload = await invokeFn("git_commits_ahead_behind", {
    repoPath,
    targetBranch,
    workingDir: workingDir ?? null,
  });
  return commitsAheadBehindSchema.parse(payload);
};

const gitGetWorktreeStatus = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  diffScope?: "target" | "uncommitted",
  workingDir?: string,
): Promise<GitWorktreeStatus> => {
  const payload = await invokeFn("git_get_worktree_status", {
    repoPath,
    targetBranch,
    diffScope: gitDiffScopeSchema.parse(diffScope ?? "target"),
    workingDir: workingDir ?? null,
  });
  return gitWorktreeStatusSchema.parse(payload);
};

const gitGetWorktreeStatusSummary = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  diffScope?: "target" | "uncommitted",
  workingDir?: string,
): Promise<GitWorktreeStatusSummary> => {
  const payload = await invokeFn("git_get_worktree_status_summary", {
    repoPath,
    targetBranch,
    diffScope: gitDiffScopeSchema.parse(diffScope ?? "target"),
    workingDir: workingDir ?? null,
  });
  return gitWorktreeStatusSummarySchema.parse(payload);
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
  const payload = await invokeFn("git_commit_all", {
    repoPath: request.repoPath,
    workingDir: request.workingDir ?? null,
    message: request.message,
  });
  return gitCommitAllResultSchema.parse(payload);
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
  const payload = await invokeFn("git_rebase_branch", {
    repoPath: request.repoPath,
    targetBranch: request.targetBranch,
    workingDir: request.workingDir ?? null,
  });
  return gitRebaseBranchResultSchema.parse(payload);
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
  const payload = await invokeFn("git_rebase_abort", {
    repoPath: request.repoPath,
    workingDir: request.workingDir ?? null,
  });
  return gitRebaseAbortResultSchema.parse(payload);
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
  const payload = await invokeFn("git_abort_conflict", {
    repoPath: request.repoPath,
    operation: request.operation,
    workingDir: request.workingDir ?? null,
  });
  return gitConflictAbortResultSchema.parse(payload);
};

export class TauriGitClient {
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
}
