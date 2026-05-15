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

export type GitRemote = {
  name: string;
  url: string;
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
  canonicalizePath(path: string): Promise<string>;
  isGitRepository(path: string): Promise<boolean>;
  shareGitCommonDirectory(repoPath: string, workingDir: string): Promise<boolean>;
  referenceExists?(workingDir: string, reference: string): Promise<boolean>;
  listRemotes(workingDir: string): Promise<GitRemote[]>;
  listBranches(workingDir: string): Promise<GitBranch[]>;
  getCurrentBranch(workingDir: string): Promise<GitCurrentBranch>;
  getStatus(workingDir: string): Promise<FileStatus[]>;
  getDiff(workingDir: string, targetBranch?: string): Promise<FileDiff[]>;
  getWorktreeStatusData(
    workingDir: string,
    targetBranch: string,
    diffScope: GitDiffScope,
  ): Promise<GitWorktreeStatusData>;
  getWorktreeStatusSummaryData(
    workingDir: string,
    targetBranch: string,
    diffScope: GitDiffScope,
  ): Promise<GitWorktreeStatusSummaryData>;
  createWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    createBranch: boolean,
    startPoint?: string,
  ): Promise<void>;
  configureBranchUpstream?(
    repoPath: string,
    worktreePath: string,
    branch: string,
    upstreamRemote: string,
  ): Promise<GitBranchUpstreamSetup>;
  deleteReference?(repoPath: string, reference: string): Promise<void>;
  removeWorktree(repoPath: string, worktreePath: string, force: boolean): Promise<void>;
  deleteLocalBranch(repoPath: string, branch: string, force: boolean): Promise<void>;
  isAncestor(workingDir: string, ancestor: string, descendant: string): Promise<boolean>;
  suggestedSquashCommitMessage(
    workingDir: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<string | undefined>;
  mergeBranch(workingDir: string, request: GitMergeBranchRequest): Promise<GitMergeBranchResult>;
  switchBranch(workingDir: string, branch: string, create: boolean): Promise<GitCurrentBranch>;
  resetWorktreeSelection(
    workingDir: string,
    fileDiffs: FileDiff[],
    selection: GitResetWorktreeSelection,
  ): Promise<GitResetWorktreeSelectionResult>;
  commitsAheadBehind(workingDir: string, targetBranch: string): Promise<CommitsAheadBehind>;
  fetchRemote(workingDir: string, targetBranch: string): Promise<GitFetchRemoteResult>;
  pullBranch(workingDir: string): Promise<GitPullBranchResult>;
  commitAll(workingDir: string, message: string): Promise<GitCommitAllResult>;
  pushBranch(
    workingDir: string,
    branch: string,
    options?: GitPushBranchOptions,
  ): Promise<GitPushBranchResult>;
  rebaseBranch(workingDir: string, targetBranch: string): Promise<GitRebaseBranchResult>;
  rebaseAbort(workingDir: string): Promise<GitRebaseAbortResult>;
  abortConflict(
    workingDir: string,
    operation: GitConflictOperation,
  ): Promise<GitConflictAbortResult>;
};
