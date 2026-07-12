import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitBranch,
  GitCommitAllResult,
  GitConflictAbortResult,
  GitCurrentBranch,
  GitFetchRemoteResult,
  GitPullBranchResult,
  GitPushBranchResult,
  GitRebaseAbortResult,
  GitRebaseBranchResult,
  GitResetWorktreeSelectionRequest,
  GitResetWorktreeSelectionResult,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
  GitWorktreeSummary,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostDependencyError,
  HostOperationError,
  HostValidationError,
} from "../../effect/host-errors";
import type { GitPortError } from "../../ports/git-port";
import type { SettingsConfigError } from "../../ports/settings-config-port";
import type { WorktreeFileError } from "../../ports/worktree-file-port";
import type {
  GitAbortConflictInput,
  GitAheadBehindInput,
  GitCommitAllInput,
  GitCreateWorktreeInput,
  GitDiffInput,
  GitPushBranchInput,
  GitRebaseBranchInput,
  GitRemoveWorktreeInput,
  GitScopeInput,
  GitSwitchBranchInput,
  GitWorktreeStatusInput,
} from "./git-service-inputs";

export type GitServiceError =
  | GitPortError
  | HostDependencyError
  | HostOperationError
  | HostValidationError
  | SettingsConfigError
  | WorktreeFileError;

export type GitService = {
  canonicalizePath(input: GitScopeInput): Effect.Effect<string, GitServiceError>;
  getBranches(input: GitScopeInput): Effect.Effect<GitBranch[], GitServiceError>;
  getCurrentBranch(input: GitScopeInput): Effect.Effect<GitCurrentBranch, GitServiceError>;
  getStatus(input: GitScopeInput): Effect.Effect<FileStatus[], GitServiceError>;
  getDiff(input: GitDiffInput): Effect.Effect<FileDiff[], GitServiceError>;
  getWorktreeStatus(
    input: GitWorktreeStatusInput,
  ): Effect.Effect<GitWorktreeStatus, GitServiceError>;
  getWorktreeStatusSummary(
    input: GitWorktreeStatusInput,
  ): Effect.Effect<GitWorktreeStatusSummary, GitServiceError>;
  createWorktree(input: GitCreateWorktreeInput): Effect.Effect<GitWorktreeSummary, GitServiceError>;
  removeWorktree(input: GitRemoveWorktreeInput): Effect.Effect<
    {
      ok: boolean;
    },
    GitServiceError
  >;
  switchBranch(input: GitSwitchBranchInput): Effect.Effect<GitCurrentBranch, GitServiceError>;
  resetWorktreeSelection(
    input: GitResetWorktreeSelectionRequest,
  ): Effect.Effect<GitResetWorktreeSelectionResult, GitServiceError>;
  commitsAheadBehind(
    input: GitAheadBehindInput,
  ): Effect.Effect<CommitsAheadBehind, GitServiceError>;
  fetchRemote(input: GitAheadBehindInput): Effect.Effect<GitFetchRemoteResult, GitServiceError>;
  pullBranch(input: GitScopeInput): Effect.Effect<GitPullBranchResult, GitServiceError>;
  commitAll(input: GitCommitAllInput): Effect.Effect<GitCommitAllResult, GitServiceError>;
  pushBranch(input: GitPushBranchInput): Effect.Effect<GitPushBranchResult, GitServiceError>;
  rebaseBranch(input: GitRebaseBranchInput): Effect.Effect<GitRebaseBranchResult, GitServiceError>;
  rebaseAbort(input: GitScopeInput): Effect.Effect<GitRebaseAbortResult, GitServiceError>;
  abortConflict(
    input: GitAbortConflictInput,
  ): Effect.Effect<GitConflictAbortResult, GitServiceError>;
};
