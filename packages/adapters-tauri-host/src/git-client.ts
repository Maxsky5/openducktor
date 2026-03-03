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
  type GitCurrentBranch,
  type GitPullBranchRequest,
  type GitPullBranchResult,
  type GitPushSummary,
  type GitRebaseBranchRequest,
  type GitRebaseBranchResult,
  type GitWorktreeStatus,
  type GitWorktreeStatusSummary,
  type GitWorktreeSummary,
  gitBranchSchema,
  gitCommitAllResultSchema,
  gitCurrentBranchSchema,
  gitDiffScopeSchema,
  gitPullBranchResultSchema,
  gitPushSummarySchema,
  gitRebaseBranchResultSchema,
  gitWorktreeStatusSchema,
  gitWorktreeStatusSummarySchema,
  gitWorktreeSummarySchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { parseArray } from "./invoke-utils";

export const gitGetBranches = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<GitBranch[]> => {
  const payload = await invokeFn<unknown>("git_get_branches", { repoPath });
  return parseArray(gitBranchSchema, payload);
};

export const gitGetCurrentBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
): Promise<GitCurrentBranch> => {
  const payload = await invokeFn<unknown>("git_get_current_branch", {
    repoPath,
    workingDir: workingDir ?? null,
  });
  return gitCurrentBranchSchema.parse(payload);
};

export const gitSwitchBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  branch: string,
  options?: { create?: boolean },
): Promise<GitCurrentBranch> => {
  const payload = await invokeFn<unknown>("git_switch_branch", {
    repoPath,
    branch,
    create: options?.create ?? false,
  });
  return gitCurrentBranchSchema.parse(payload);
};

export const gitCreateWorktree = async (
  invokeFn: InvokeFn,
  repoPath: string,
  worktreePath: string,
  branch: string,
  options?: { createBranch?: boolean },
): Promise<GitWorktreeSummary> => {
  const payload = await invokeFn<unknown>("git_create_worktree", {
    repoPath,
    worktreePath,
    branch,
    createBranch: options?.createBranch ?? false,
  });
  return gitWorktreeSummarySchema.parse(payload);
};

export const gitRemoveWorktree = async (
  invokeFn: InvokeFn,
  repoPath: string,
  worktreePath: string,
  options?: { force?: boolean },
): Promise<{ ok: boolean }> => {
  return invokeFn<{ ok: boolean }>("git_remove_worktree", {
    repoPath,
    worktreePath,
    force: options?.force ?? false,
  });
};

export const gitPushBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  branch: string,
  options?: {
    remote?: string;
    setUpstream?: boolean;
    forceWithLease?: boolean;
    workingDir?: string;
  },
): Promise<GitPushSummary> => {
  const payload = await invokeFn<unknown>("git_push_branch", {
    repoPath,
    branch,
    remote: options?.remote,
    setUpstream: options?.setUpstream ?? false,
    forceWithLease: options?.forceWithLease ?? false,
    workingDir: options?.workingDir ?? null,
  });
  return gitPushSummarySchema.parse(payload);
};

export const gitPullBranch = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
): Promise<GitPullBranchResult> => {
  const request: GitPullBranchRequest = {
    repoPath,
    workingDir,
  };
  const payload = await invokeFn<unknown>("git_pull_branch", {
    repoPath: request.repoPath,
    workingDir: request.workingDir ?? null,
  });
  return gitPullBranchResultSchema.parse(payload);
};

export const gitGetStatus = async (
  invokeFn: InvokeFn,
  repoPath: string,
  workingDir?: string,
): Promise<FileStatus[]> => {
  const payload = await invokeFn<unknown>("git_get_status", {
    repoPath,
    workingDir: workingDir ?? null,
  });
  return parseArray(fileStatusSchema, payload);
};

export const gitGetDiff = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch?: string,
  workingDir?: string,
): Promise<FileDiff[]> => {
  const payload = await invokeFn<unknown>("git_get_diff", {
    repoPath,
    targetBranch: targetBranch ?? null,
    workingDir: workingDir ?? null,
  });
  return parseArray(fileDiffSchema, payload);
};

export const gitCommitsAheadBehind = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  workingDir?: string,
): Promise<CommitsAheadBehind> => {
  const payload = await invokeFn<unknown>("git_commits_ahead_behind", {
    repoPath,
    targetBranch,
    workingDir: workingDir ?? null,
  });
  return commitsAheadBehindSchema.parse(payload);
};

export const gitGetWorktreeStatus = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  diffScope?: "target" | "uncommitted",
  workingDir?: string,
): Promise<GitWorktreeStatus> => {
  const payload = await invokeFn<unknown>("git_get_worktree_status", {
    repoPath,
    targetBranch,
    diffScope: gitDiffScopeSchema.parse(diffScope ?? "target"),
    workingDir: workingDir ?? null,
  });
  return gitWorktreeStatusSchema.parse(payload);
};

export const gitGetWorktreeStatusSummary = async (
  invokeFn: InvokeFn,
  repoPath: string,
  targetBranch: string,
  diffScope?: "target" | "uncommitted",
  workingDir?: string,
): Promise<GitWorktreeStatusSummary> => {
  const payload = await invokeFn<unknown>("git_get_worktree_status_summary", {
    repoPath,
    targetBranch,
    diffScope: gitDiffScopeSchema.parse(diffScope ?? "target"),
    workingDir: workingDir ?? null,
  });
  return gitWorktreeStatusSummarySchema.parse(payload);
};

export const gitCommitAll = async (
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
  const payload = await invokeFn<unknown>("git_commit_all", {
    repoPath: request.repoPath,
    workingDir: request.workingDir ?? null,
    message: request.message,
  });
  return gitCommitAllResultSchema.parse(payload);
};

export const gitRebaseBranch = async (
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
  const payload = await invokeFn<unknown>("git_rebase_branch", {
    repoPath: request.repoPath,
    targetBranch: request.targetBranch,
    workingDir: request.workingDir ?? null,
  });
  return gitRebaseBranchResultSchema.parse(payload);
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
  ): Promise<GitPushSummary> {
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
}
