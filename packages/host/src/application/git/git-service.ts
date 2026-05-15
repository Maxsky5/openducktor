import {
  type CommitsAheadBehind,
  commitsAheadBehindSchema,
  type FileDiff,
  type FileStatus,
  fileDiffSchema,
  fileStatusSchema,
  type GitBranch,
  type GitCommitAllResult,
  type GitConflictAbortResult,
  type GitCurrentBranch,
  type GitFetchRemoteResult,
  type GitPullBranchResult,
  type GitPushBranchResult,
  type GitRebaseAbortResult,
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
  gitFetchRemoteResultSchema,
  gitPullBranchResultSchema,
  gitPushBranchResultSchema,
  gitRebaseAbortResultSchema,
  gitRebaseBranchResultSchema,
  gitResetWorktreeSelectionResultSchema,
  gitWorktreeStatusSchema,
  gitWorktreeStatusSummarySchema,
  gitWorktreeSummarySchema,
} from "@openducktor/contracts";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";

import {
  cleanupFailedCreatedWorktree,
  findRepoConfigByPath,
  type GitAbortConflictInput,
  type GitAheadBehindInput,
  type GitCommitAllInput,
  type GitCreateWorktreeInput,
  type GitDiffInput,
  type GitPushBranchInput,
  type GitRebaseBranchInput,
  type GitRemoveWorktreeInput,
  type GitScopeInput,
  type GitSwitchBranchInput,
  type GitWorktreeStatusInput,
  normalizeCreateGitServiceInput,
  requireSettingsConfig,
  requireWorktreeFiles,
  resolveGitWorkingDirectory,
} from "./git-service-inputs";
import {
  createWorktreeSnapshot,
  hashWorktreeDiffPayload,
  hashWorktreeDiffSummaryPayload,
  hashWorktreeStatusPayload,
  validateResetSnapshotMatches,
} from "./git-worktree-snapshot";
import { removeWorktreeAndFilesystemPath } from "./worktree-removal";

export type GitService = {
  getBranches(input: GitScopeInput): Promise<GitBranch[]>;
  getCurrentBranch(input: GitScopeInput): Promise<GitCurrentBranch>;
  getStatus(input: GitScopeInput): Promise<FileStatus[]>;
  getDiff(input: GitDiffInput): Promise<FileDiff[]>;
  getWorktreeStatus(input: GitWorktreeStatusInput): Promise<GitWorktreeStatus>;
  getWorktreeStatusSummary(input: GitWorktreeStatusInput): Promise<GitWorktreeStatusSummary>;
  createWorktree(input: GitCreateWorktreeInput): Promise<GitWorktreeSummary>;
  removeWorktree(input: GitRemoveWorktreeInput): Promise<{ ok: boolean }>;
  switchBranch(input: GitSwitchBranchInput): Promise<GitCurrentBranch>;
  resetWorktreeSelection(
    input: GitResetWorktreeSelectionRequest,
  ): Promise<GitResetWorktreeSelectionResult>;
  commitsAheadBehind(input: GitAheadBehindInput): Promise<CommitsAheadBehind>;
  fetchRemote(input: GitAheadBehindInput): Promise<GitFetchRemoteResult>;
  pullBranch(input: GitScopeInput): Promise<GitPullBranchResult>;
  commitAll(input: GitCommitAllInput): Promise<GitCommitAllResult>;
  pushBranch(input: GitPushBranchInput): Promise<GitPushBranchResult>;
  rebaseBranch(input: GitRebaseBranchInput): Promise<GitRebaseBranchResult>;
  rebaseAbort(input: GitScopeInput): Promise<GitRebaseAbortResult>;
  abortConflict(input: GitAbortConflictInput): Promise<GitConflictAbortResult>;
};

export type CreateGitServiceInput = {
  gitPort: GitPort;
  settingsConfig?: SettingsConfigPort;
  worktreeFiles?: WorktreeFilePort;
};

export const createGitService = (input: GitPort | CreateGitServiceInput): GitService => {
  const { gitPort, settingsConfig, worktreeFiles } = normalizeCreateGitServiceInput(input);

  return {
    async getBranches(input) {
      const { repoPath } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, undefined);
      const branches = await gitPort.listBranches(workingDirectory);
      return branches.map((branch) => gitBranchSchema.parse(branch));
    },
    async getCurrentBranch(input) {
      const { repoPath, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitCurrentBranchSchema.parse(await gitPort.getCurrentBranch(workingDirectory));
    },
    async getStatus(input) {
      const { repoPath, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      const statuses = await gitPort.getStatus(workingDirectory);
      return statuses.map((status) => fileStatusSchema.parse(status));
    },
    async getDiff(input) {
      const { repoPath, targetBranch, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      const diffs = await gitPort.getDiff(workingDirectory, targetBranch);
      return diffs.map((diff) => fileDiffSchema.parse(diff));
    },
    async getWorktreeStatus(input) {
      const { repoPath, targetBranch, diffScope, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      const statusData = await gitPort.getWorktreeStatusData(
        workingDirectory,
        targetBranch,
        diffScope,
      );
      const snapshot = createWorktreeSnapshot(
        workingDirectory,
        targetBranch,
        diffScope,
        hashWorktreeStatusPayload(
          statusData.currentBranch,
          statusData.fileStatuses,
          statusData.targetAheadBehind,
          statusData.upstreamAheadBehind,
        ),
        hashWorktreeDiffPayload(statusData.fileDiffs),
      );

      return gitWorktreeStatusSchema.parse({
        currentBranch: statusData.currentBranch,
        fileStatuses: statusData.fileStatuses,
        fileDiffs: statusData.fileDiffs,
        targetAheadBehind: statusData.targetAheadBehind,
        upstreamAheadBehind: statusData.upstreamAheadBehind,
        gitConflict: statusData.gitConflict
          ? { ...statusData.gitConflict, workingDir: workingDirectory }
          : undefined,
        snapshot,
      });
    },
    async getWorktreeStatusSummary(input) {
      const { repoPath, targetBranch, diffScope, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      const summaryData = await gitPort.getWorktreeStatusSummaryData(
        workingDirectory,
        targetBranch,
        diffScope,
      );
      const snapshot = createWorktreeSnapshot(
        workingDirectory,
        targetBranch,
        diffScope,
        hashWorktreeStatusPayload(
          summaryData.currentBranch,
          summaryData.fileStatuses,
          summaryData.targetAheadBehind,
          summaryData.upstreamAheadBehind,
        ),
        hashWorktreeDiffSummaryPayload(
          diffScope,
          summaryData.targetAheadBehind,
          summaryData.fileStatusCounts,
        ),
      );

      return gitWorktreeStatusSummarySchema.parse({
        currentBranch: summaryData.currentBranch,
        fileStatusCounts: summaryData.fileStatusCounts,
        targetAheadBehind: summaryData.targetAheadBehind,
        upstreamAheadBehind: summaryData.upstreamAheadBehind,
        gitConflict: summaryData.gitConflict
          ? { ...summaryData.gitConflict, workingDir: workingDirectory }
          : undefined,
        snapshot,
      });
    },
    async commitsAheadBehind(input) {
      const { repoPath, targetBranch, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return commitsAheadBehindSchema.parse(
        await gitPort.commitsAheadBehind(workingDirectory, targetBranch),
      );
    },
    async switchBranch(input) {
      const { repoPath, branch, create } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, undefined);
      return gitCurrentBranchSchema.parse(
        await gitPort.switchBranch(workingDirectory, branch, create),
      );
    },
    async createWorktree(input) {
      const { repoPath, worktreePath, branch, createBranch } = input;
      const canonicalRepoPath = await resolveGitWorkingDirectory(gitPort, repoPath, undefined);
      const config = requireSettingsConfig(settingsConfig);
      const repoConfig = await findRepoConfigByPath(config, canonicalRepoPath);
      const files = requireWorktreeFiles(worktreeFiles);

      await gitPort.createWorktree(canonicalRepoPath, worktreePath, branch, createBranch);
      try {
        await files.copyConfiguredPaths(
          canonicalRepoPath,
          worktreePath,
          repoConfig.worktreeCopyPaths,
        );
      } catch (error) {
        const cleanupError = await cleanupFailedCreatedWorktree(
          gitPort,
          canonicalRepoPath,
          worktreePath,
          branch,
          createBranch,
        );
        throw new Error(`Configured worktree copy failed: ${String(error)}${cleanupError}`, {
          cause: error,
        });
      }

      return gitWorktreeSummarySchema.parse({
        branch,
        worktreePath,
      });
    },
    async removeWorktree(input) {
      const { repoPath, worktreePath, force } = input;
      const canonicalRepoPath = await resolveGitWorkingDirectory(gitPort, repoPath, undefined);
      const files = requireWorktreeFiles(worktreeFiles);
      await removeWorktreeAndFilesystemPath(
        {
          gitPort,
          settingsConfig: requireSettingsConfig(settingsConfig),
          worktreeFiles: files,
        },
        {
          repoPath: canonicalRepoPath,
          worktreePath,
          force,
        },
      );
      return { ok: true };
    },
    async resetWorktreeSelection(input) {
      const request = input;
      const workingDirectory = await resolveGitWorkingDirectory(
        gitPort,
        request.repoPath,
        request.workingDir,
      );
      const statusData = await gitPort.getWorktreeStatusData(
        workingDirectory,
        request.targetBranch,
        "uncommitted",
      );
      validateResetSnapshotMatches(request.snapshot, statusData);
      return gitResetWorktreeSelectionResultSchema.parse(
        await gitPort.resetWorktreeSelection(
          workingDirectory,
          statusData.fileDiffs,
          request.selection,
        ),
      );
    },
    async fetchRemote(input) {
      const { repoPath, targetBranch, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitFetchRemoteResultSchema.parse(
        await gitPort.fetchRemote(workingDirectory, targetBranch),
      );
    },
    async pullBranch(input) {
      const { repoPath, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitPullBranchResultSchema.parse(await gitPort.pullBranch(workingDirectory));
    },
    async commitAll(input) {
      const { repoPath, message, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitCommitAllResultSchema.parse(await gitPort.commitAll(workingDirectory, message));
    },
    async pushBranch(input) {
      const { repoPath, branch, remote, workingDir, setUpstream, forceWithLease } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitPushBranchResultSchema.parse(
        await gitPort.pushBranch(workingDirectory, branch, {
          remote,
          setUpstream: setUpstream ?? false,
          forceWithLease: forceWithLease ?? false,
        }),
      );
    },
    async rebaseBranch(input) {
      const { repoPath, targetBranch, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitRebaseBranchResultSchema.parse(
        await gitPort.rebaseBranch(workingDirectory, targetBranch),
      );
    },
    async rebaseAbort(input) {
      const { repoPath, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitRebaseAbortResultSchema.parse(await gitPort.rebaseAbort(workingDirectory));
    },
    async abortConflict(input) {
      const { repoPath, operation, workingDir } = input;
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitConflictAbortResultSchema.parse(
        await gitPort.abortConflict(workingDirectory, operation),
      );
    },
  };
};
