import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitBranch,
  GitCommitAllResult,
  GitConflict,
  GitConflictAbortResult,
  GitConflictOperation,
  GitCurrentBranch,
  GitDiffScope,
  GitFetchRemoteResult,
  GitFileStatusCounts,
  GitMergeMethod,
  GitPullBranchResult,
  GitPushBranchResult,
  GitRebaseAbortResult,
  GitRebaseBranchResult,
  GitResetWorktreeSelection,
  GitResetWorktreeSelectionResult,
  GitUpstreamAheadBehind,
} from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type {
  HostOperationError,
  HostPathAccessError,
  HostResourceError,
  HostValidationError,
} from "../effect/host-errors";

export type GitPortError =
  | HostOperationError
  | HostPathAccessError
  | HostResourceError
  | HostValidationError;

export type GitRemote = {
  name: string;
  url: string;
};
export type GitChangedFile = {
  path: string;
  status: string;
};
export type GitWorktreeStatusData = {
  currentBranch: GitCurrentBranch;
  fileStatuses: FileStatus[];
  fileDiffs: FileDiff[];
  targetAheadBehind: CommitsAheadBehind;
  upstreamAheadBehind: GitUpstreamAheadBehind;
  gitConflict?: GitConflict;
};
export type GitWorktreeStatusSummaryData = {
  currentBranch: GitCurrentBranch;
  fileStatuses: FileStatus[];
  fileStatusCounts: GitFileStatusCounts;
  targetAheadBehind: CommitsAheadBehind;
  upstreamAheadBehind: GitUpstreamAheadBehind;
  gitConflict?: GitConflict;
};
export type GitPushBranchOptions = {
  remote?: string;
  setUpstream?: boolean;
  forceWithLease?: boolean;
};
export type GitMergeBranchRequest = {
  sourceBranch: string;
  targetBranch: string;
  sourceWorkingDirectory?: string;
  method: GitMergeMethod;
  squashCommitMessage?: string;
};
export type GitMergeBranchResult =
  | {
      outcome: "merged";
      output: string;
    }
  | {
      outcome: "up_to_date";
      output: string;
    }
  | {
      outcome: "conflicts";
      conflictedFiles: string[];
      output: string;
    };
export type GitBranchUpstreamSetup = {
  createdTrackingRef: string | null;
};
export type GitPort = {
  canonicalizePath(path: string): Effect.Effect<string, HostOperationError>;
  isGitRepository(path: string): Effect.Effect<boolean, GitPortError>;
  shareGitCommonDirectory(
    repoPath: string,
    workingDir: string,
  ): Effect.Effect<boolean, GitPortError>;
  referenceExists(workingDir: string, reference: string): Effect.Effect<boolean, GitPortError>;
  listRemotes(workingDir: string): Effect.Effect<GitRemote[], GitPortError>;
  listBranches(workingDir: string): Effect.Effect<GitBranch[], GitPortError>;
  listFiles(workingDir: string): Effect.Effect<string[], GitPortError>;
  getCurrentBranch(workingDir: string): Effect.Effect<GitCurrentBranch, GitPortError>;
  getStatus(workingDir: string): Effect.Effect<FileStatus[], GitPortError>;
  listChangedFiles(
    workingDir: string,
    targetBranch: string,
  ): Effect.Effect<GitChangedFile[], GitPortError>;
  getDiff(workingDir: string, targetBranch?: string): Effect.Effect<FileDiff[], GitPortError>;
  getWorktreeStatusData(
    workingDir: string,
    targetBranch: string,
    diffScope: GitDiffScope,
  ): Effect.Effect<GitWorktreeStatusData, GitPortError>;
  getWorktreeStatusSummaryData(
    workingDir: string,
    targetBranch: string,
    diffScope: GitDiffScope,
  ): Effect.Effect<GitWorktreeStatusSummaryData, GitPortError>;
  createWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    createBranch: boolean,
    startPoint?: string,
  ): Effect.Effect<void, GitPortError>;
  configureBranchUpstream(
    repoPath: string,
    worktreePath: string,
    branch: string,
    upstreamRemote: string,
  ): Effect.Effect<GitBranchUpstreamSetup, GitPortError>;
  deleteReference(repoPath: string, reference: string): Effect.Effect<void, GitPortError>;
  removeWorktree(
    repoPath: string,
    worktreePath: string,
    force: boolean,
  ): Effect.Effect<void, GitPortError>;
  deleteLocalBranch(
    repoPath: string,
    branch: string,
    force: boolean,
  ): Effect.Effect<void, GitPortError>;
  isAncestor(
    workingDir: string,
    ancestor: string,
    descendant: string,
  ): Effect.Effect<boolean, GitPortError>;
  suggestedSquashCommitMessage(
    workingDir: string,
    sourceBranch: string,
    targetBranch: string,
  ): Effect.Effect<string | undefined, GitPortError>;
  mergeBranch(
    workingDir: string,
    request: GitMergeBranchRequest,
  ): Effect.Effect<GitMergeBranchResult, GitPortError>;
  switchBranch(
    workingDir: string,
    branch: string,
    create: boolean,
  ): Effect.Effect<GitCurrentBranch, GitPortError>;
  resetWorktreeSelection(
    workingDir: string,
    fileDiffs: FileDiff[],
    selection: GitResetWorktreeSelection,
  ): Effect.Effect<GitResetWorktreeSelectionResult, GitPortError>;
  commitsAheadBehind(
    workingDir: string,
    targetBranch: string,
  ): Effect.Effect<CommitsAheadBehind, GitPortError>;
  fetchRemote(
    workingDir: string,
    targetBranch: string,
  ): Effect.Effect<GitFetchRemoteResult, GitPortError>;
  pullBranch(workingDir: string): Effect.Effect<GitPullBranchResult, GitPortError>;
  commitAll(workingDir: string, message: string): Effect.Effect<GitCommitAllResult, GitPortError>;
  pushBranch(
    workingDir: string,
    branch: string,
    options?: GitPushBranchOptions,
  ): Effect.Effect<GitPushBranchResult, GitPortError>;
  rebaseBranch(
    workingDir: string,
    targetBranch: string,
  ): Effect.Effect<GitRebaseBranchResult, GitPortError>;
  rebaseAbort(workingDir: string): Effect.Effect<GitRebaseAbortResult, GitPortError>;
  abortConflict(
    workingDir: string,
    operation: GitConflictOperation,
  ): Effect.Effect<GitConflictAbortResult, GitPortError>;
};

export class GitPortTag extends Context.Tag("@openducktor/host/GitPort")<GitPortTag, GitPort>() {}
