import {
  type GitBranch,
  type GitCurrentBranch,
  type GitPushSummary,
  type GitWorktreeSummary,
  gitBranchSchema,
  gitCurrentBranchSchema,
  gitPushSummarySchema,
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
): Promise<GitCurrentBranch> => {
  const payload = await invokeFn<unknown>("git_get_current_branch", { repoPath });
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
  },
): Promise<GitPushSummary> => {
  const payload = await invokeFn<unknown>("git_push_branch", {
    repoPath,
    branch,
    remote: options?.remote,
    setUpstream: options?.setUpstream ?? false,
    forceWithLease: options?.forceWithLease ?? false,
  });
  return gitPushSummarySchema.parse(payload);
};

export class TauriGitClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async gitGetBranches(repoPath: string): Promise<GitBranch[]> {
    return gitGetBranches(this.invokeFn, repoPath);
  }

  async gitGetCurrentBranch(repoPath: string): Promise<GitCurrentBranch> {
    return gitGetCurrentBranch(this.invokeFn, repoPath);
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
    },
  ): Promise<GitPushSummary> {
    return gitPushBranch(this.invokeFn, repoPath, branch, options);
  }
}
