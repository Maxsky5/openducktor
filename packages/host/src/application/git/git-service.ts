import {
  commitsAheadBehindSchema,
  fileDiffSchema,
  fileStatusSchema,
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
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import {
  type CreateGitServiceInput,
  cleanupFailedCreatedWorktree,
  findRepoConfigByPath,
  normalizeCreateGitServiceInput,
  requireSettingsConfig,
  requireWorktreeFiles,
  resolveGitWorkingDirectory,
} from "./git-service-inputs";
import type { GitService } from "./git-service-types";
import {
  createWorktreeSnapshot,
  hashWorktreeDiffPayload,
  hashWorktreeDiffSummaryPayload,
  hashWorktreeStatusPayload,
  validateResetSnapshotMatches,
} from "./git-worktree-snapshot";
import { removeWorktreeAndFilesystemPath } from "./worktree-removal";

export type { CreateGitServiceInput } from "./git-service-inputs";
export type { GitService, GitServiceError } from "./git-service-types";
export const createGitService = (input: GitPort | CreateGitServiceInput): GitService => {
  const { gitPort, settingsConfig, worktreeFiles } = normalizeCreateGitServiceInput(input);
  return {
    getBranches(input) {
      return Effect.gen(function* () {
        const { repoPath } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, undefined);
        const branches = yield* gitPort.listBranches(workingDirectory);
        return yield* Effect.try({
          try: () => branches.map((branch) => gitBranchSchema.parse(branch)),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    getCurrentBranch(input) {
      return Effect.gen(function* () {
        const { repoPath, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const currentBranch = yield* gitPort.getCurrentBranch(workingDirectory);
        return yield* Effect.try({
          try: () => gitCurrentBranchSchema.parse(currentBranch),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    getStatus(input) {
      return Effect.gen(function* () {
        const { repoPath, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const statuses = yield* gitPort.getStatus(workingDirectory);
        return yield* Effect.try({
          try: () => statuses.map((status) => fileStatusSchema.parse(status)),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    getDiff(input) {
      return Effect.gen(function* () {
        const { repoPath, targetBranch, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const diffs = yield* gitPort.getDiff(workingDirectory, targetBranch);
        return yield* Effect.try({
          try: () => diffs.map((diff) => fileDiffSchema.parse(diff)),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    getWorktreeStatus(input) {
      return Effect.gen(function* () {
        const { repoPath, targetBranch, diffScope, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const statusData = yield* gitPort.getWorktreeStatusData(
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
        return yield* Effect.try({
          try: () =>
            gitWorktreeStatusSchema.parse({
              currentBranch: statusData.currentBranch,
              fileStatuses: statusData.fileStatuses,
              fileDiffs: statusData.fileDiffs,
              targetAheadBehind: statusData.targetAheadBehind,
              upstreamAheadBehind: statusData.upstreamAheadBehind,
              gitConflict: statusData.gitConflict
                ? { ...statusData.gitConflict, workingDir: workingDirectory }
                : undefined,
              snapshot,
            }),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    getWorktreeStatusSummary(input) {
      return Effect.gen(function* () {
        const { repoPath, targetBranch, diffScope, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const summaryData = yield* gitPort.getWorktreeStatusSummaryData(
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
        return yield* Effect.try({
          try: () =>
            gitWorktreeStatusSummarySchema.parse({
              currentBranch: summaryData.currentBranch,
              fileStatusCounts: summaryData.fileStatusCounts,
              targetAheadBehind: summaryData.targetAheadBehind,
              upstreamAheadBehind: summaryData.upstreamAheadBehind,
              gitConflict: summaryData.gitConflict
                ? { ...summaryData.gitConflict, workingDir: workingDirectory }
                : undefined,
              snapshot,
            }),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    commitsAheadBehind(input) {
      return Effect.gen(function* () {
        const { repoPath, targetBranch, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const aheadBehind = yield* gitPort.commitsAheadBehind(workingDirectory, targetBranch);
        return yield* Effect.try({
          try: () => commitsAheadBehindSchema.parse(aheadBehind),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    switchBranch(input) {
      return Effect.gen(function* () {
        const { repoPath, branch, create } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, undefined);
        const currentBranch = yield* gitPort.switchBranch(workingDirectory, branch, create);
        return yield* Effect.try({
          try: () => gitCurrentBranchSchema.parse(currentBranch),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    createWorktree(input) {
      return Effect.gen(function* () {
        const { repoPath, worktreePath, branch, createBranch } = input;
        const canonicalRepoPath = yield* resolveGitWorkingDirectory(gitPort, repoPath, undefined);
        const config = requireSettingsConfig(settingsConfig);
        const repoConfig = yield* findRepoConfigByPath(config, canonicalRepoPath);
        const files = requireWorktreeFiles(worktreeFiles);
        yield* gitPort.createWorktree(canonicalRepoPath, worktreePath, branch, createBranch);
        yield* files
          .copyConfiguredPaths(canonicalRepoPath, worktreePath, repoConfig.worktreeCopyPaths)
          .pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const cleanupError = yield* cleanupFailedCreatedWorktree(
                  gitPort,
                  canonicalRepoPath,
                  worktreePath,
                  branch,
                  createBranch,
                );
                return yield* Effect.fail(
                  new HostOperationError({
                    operation: "git.create_worktree.copy_configured_paths",
                    message: `Configured worktree copy failed: ${String(error)}${cleanupError}`,
                    cause: error,
                  }),
                );
              }),
            ),
          );
        return yield* Effect.try({
          try: () =>
            gitWorktreeSummarySchema.parse({
              branch,
              worktreePath,
            }),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    removeWorktree(input) {
      return Effect.gen(function* () {
        const { repoPath, worktreePath, force } = input;
        const canonicalRepoPath = yield* resolveGitWorkingDirectory(gitPort, repoPath, undefined);
        const files = requireWorktreeFiles(worktreeFiles);
        yield* removeWorktreeAndFilesystemPath(
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
      });
    },
    resetWorktreeSelection(input) {
      return Effect.gen(function* () {
        const request = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(
          gitPort,
          request.repoPath,
          request.workingDir,
        );
        const statusData = yield* gitPort.getWorktreeStatusData(
          workingDirectory,
          request.targetBranch,
          "uncommitted",
        );
        yield* Effect.try({
          try: () => validateResetSnapshotMatches(request.snapshot, statusData),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
        const result = yield* gitPort.resetWorktreeSelection(
          workingDirectory,
          statusData.fileDiffs,
          request.selection,
        );
        return yield* Effect.try({
          try: () => gitResetWorktreeSelectionResultSchema.parse(result),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    fetchRemote(input) {
      return Effect.gen(function* () {
        const { repoPath, targetBranch, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const result = yield* gitPort.fetchRemote(workingDirectory, targetBranch);
        return yield* Effect.try({
          try: () => gitFetchRemoteResultSchema.parse(result),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    pullBranch(input) {
      return Effect.gen(function* () {
        const { repoPath, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const result = yield* gitPort.pullBranch(workingDirectory);
        return yield* Effect.try({
          try: () => gitPullBranchResultSchema.parse(result),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    commitAll(input) {
      return Effect.gen(function* () {
        const { repoPath, message, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const result = yield* gitPort.commitAll(workingDirectory, message);
        return yield* Effect.try({
          try: () => gitCommitAllResultSchema.parse(result),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    pushBranch(input) {
      return Effect.gen(function* () {
        const { repoPath, branch, remote, workingDir, setUpstream, forceWithLease } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const result = yield* gitPort.pushBranch(workingDirectory, branch, {
          remote,
          setUpstream: setUpstream ?? false,
          forceWithLease: forceWithLease ?? false,
        });
        return yield* Effect.try({
          try: () => gitPushBranchResultSchema.parse(result),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    rebaseBranch(input) {
      return Effect.gen(function* () {
        const { repoPath, targetBranch, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const result = yield* gitPort.rebaseBranch(workingDirectory, targetBranch);
        return yield* Effect.try({
          try: () => gitRebaseBranchResultSchema.parse(result),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    rebaseAbort(input) {
      return Effect.gen(function* () {
        const { repoPath, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const result = yield* gitPort.rebaseAbort(workingDirectory);
        return yield* Effect.try({
          try: () => gitRebaseAbortResultSchema.parse(result),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
    abortConflict(input) {
      return Effect.gen(function* () {
        const { repoPath, operation, workingDir } = input;
        const workingDirectory = yield* resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
        const result = yield* gitPort.abortConflict(workingDirectory, operation);
        return yield* Effect.try({
          try: () => gitConflictAbortResultSchema.parse(result),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      });
    },
  };
};
