import type {
  CommitsAheadBehind,
  GitFileDiff,
  FileStatus,
  GitBranch,
  GitChangeSelectionRequest,
  GitChangeSelectionResult,
  GitCommitAllResult,
  GitCommitStagedRequest,
  GitConflictAbortResult,
  GitCurrentBranch,
  GitComparisonTarget,
  GitFetchRemoteResult,
  GitHistoryPage,
  GitHistoryPageRequest,
  GitLocalChanges,
  GitLocalChangesRequest,
  GitPullBranchResult,
  GitPushBranchResult,
  GitRebaseAbortResult,
  GitRebaseBranchResult,
  GitWorktreeStatus,
  GitWorktreeSummary,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostDependencyErrorAggregate,
  HostOperationErrorAggregate,
  HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { GitPortError } from "../../ports/git-port";
import type { SettingsConfigError } from "../../ports/settings-config-port";
import type { WorktreeFileError } from "../../ports/worktree-file-port";
import type {
  GitAbortConflictInput,
  GitAheadBehindInput,
  GitCommitAllInput,
  GitComparisonTargetInput,
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
  | HostDependencyErrorAggregate
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate
  | SettingsConfigError
  | WorktreeFileError;

export type GitService = {
  canonicalizePath(input: GitScopeInput): Effect.Effect<string, GitServiceError>;
  getBranches(input: GitScopeInput): Effect.Effect<GitBranch[], GitServiceError>;
  getCurrentBranch(input: GitScopeInput): Effect.Effect<GitCurrentBranch, GitServiceError>;
  getComparisonTarget(
    input: GitComparisonTargetInput,
  ): Effect.Effect<GitComparisonTarget, GitServiceError>;
  getStatus(input: GitScopeInput): Effect.Effect<FileStatus[], GitServiceError>;
  getDiff(input: GitDiffInput): Effect.Effect<GitFileDiff[], GitServiceError>;
  getWorktreeStatus(
    input: GitWorktreeStatusInput,
  ): Effect.Effect<GitWorktreeStatus, GitServiceError>;
  getLocalChanges(input: GitLocalChangesRequest): Effect.Effect<GitLocalChanges, GitServiceError>;
  changeSelection(
    input: GitChangeSelectionRequest,
  ): Effect.Effect<GitChangeSelectionResult, GitServiceError>;
  commitStaged(input: GitCommitStagedRequest): Effect.Effect<GitCommitAllResult, GitServiceError>;
  getHistoryPage(input: GitHistoryPageRequest): Effect.Effect<GitHistoryPage, GitServiceError>;
  createWorktree(input: GitCreateWorktreeInput): Effect.Effect<GitWorktreeSummary, GitServiceError>;
  removeWorktree(input: GitRemoveWorktreeInput): Effect.Effect<
    {
      ok: boolean;
    },
    GitServiceError
  >;
  switchBranch(input: GitSwitchBranchInput): Effect.Effect<GitCurrentBranch, GitServiceError>;
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
