import type {
  GitReadContext,
  WorkspaceFileTreeContext,
  CommitsAheadBehind,
  GitFileDiff,
  FileStatus,
  GitBranch,
  GitCommitAllResult,
  GitConflict,
  GitConflictAbortResult,
  GitConflictOperation,
  GitChangeSelectionRequest,
  GitChangeSelectionResult,
  GitCurrentBranch,
  GitDiffScope,
  GitFetchRemoteResult,
  GitFileStatusCounts,
  GitHistoryPage,
  GitHistoryPageRequest,
  GitMergeMethod,
  GitPullBranchResult,
  GitPushBranchResult,
  GitRebaseAbortResult,
  GitRebaseBranchResult,
  GitUpstreamAheadBehind,
  GitWorktreeSummary,
} from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
  HostResourceErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

export type GitPortError =
  | HostOperationErrorAggregate
  | HostPathAccessErrorAggregate
  | HostResourceErrorAggregate
  | HostValidationErrorAggregate;

export type GitRemote = {
  name: string;
  url: string;
};
export type GitRemoteEndpoint = {
  name: string;
  fetchUrls: string[];
  pushUrls: string[];
};
export type GitChangedFile = {
  path: string;
  originalPath?: string;
  status: string;
};
export type GitFileStatus = FileStatus & {
  originalPath?: string;
};
export type GitFileListEntry = {
  kind: "directory" | "file";
  path: string;
  worktreeKind?: "directory" | "file";
};
export type GitFileListOptions = {
  caseInsensitive?: boolean;
};
export type GitWorktreeStatusData = {
  currentBranch: GitCurrentBranch;
  fileStatuses: FileStatus[];
  fileDiffs: GitFileDiff[];
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
export type GitLocalChangeGroupData = {
  fileStatuses: GitFileStatus[];
  fileDiffs: GitFileDiff[];
};
export type GitLocalChangesData = {
  currentBranch: GitCurrentBranch;
  fileStatuses: FileStatus[];
  unstaged: GitLocalChangeGroupData;
  staged: GitLocalChangeGroupData;
  conflicted: GitLocalChangeGroupData;
  upstreamAheadBehind: GitUpstreamAheadBehind;
  gitConflict?: GitConflict;
};
export type GitChangeInput = Pick<GitChangeSelectionRequest, "action" | "group" | "selection">;
export type GitHistoryPageInput = {
  /** The checkout that the service confirmed for this read. */
  currentBranch: GitCurrentBranch;
  targetReference: string;
  page?: GitHistoryPageRequest["page"];
};
export type GitPushBranchOptions = {
  remote?: string;
  setUpstream?: boolean;
  forceWithLease?: boolean;
};
export type BoundGitPublication = {
  repoPath: string;
  sourceRef: string;
  sourceOid: string;
  targetRef: string;
  remote: string;
  endpoints: Array<{ identity: string; label: string; url: string }>;
};
export type GitPublicationProgress = {
  sourceOid: string;
  targetRef: string;
  destinations: Array<{
    identity: string;
    outcome: "not_issued" | "refused" | "confirmed" | "uncertain";
  }>;
};
export type RemoteBranchObservation = { destinationIdentity: string; oid: string | null };
export type GitMergeBranchRequest = {
  onWorkIssued?: () => void;
  onApplied?: (targetOid: string) => void;
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
  readPublicationTarget(input: {
    repoPath: string;
    sourceRef: string;
    remote: string;
    targetRef: string;
  }): Effect.Effect<BoundGitPublication, GitPortError>;
  inspectPublication(
    target: BoundGitPublication,
  ): Effect.Effect<RemoteBranchObservation[], GitPortError>;
  releaseReadCaptures(): Effect.Effect<void>;
  canonicalizePath(path: string): Effect.Effect<string, HostOperationErrorAggregate>;
  isGitRepository(path: string): Effect.Effect<boolean, GitPortError>;
  getRepositoryRoot(workingDirectory: string): Effect.Effect<string, GitPortError>;
  shareGitCommonDirectory(
    repoPath: string,
    workingDir: string,
  ): Effect.Effect<boolean, GitPortError>;
  isRegisteredWorktree(
    repoPath: string,
    worktreePath: string,
  ): Effect.Effect<boolean, GitPortError>;
  listWorktrees(repoPath: string): Effect.Effect<GitWorktreeSummary[], GitPortError>;
  getTrackedUpstreamReference(workingDir: string): Effect.Effect<string | null, GitPortError>;
  referenceExists(workingDir: string, reference: string): Effect.Effect<boolean, GitPortError>;
  listRemotes(workingDir: string): Effect.Effect<GitRemote[], GitPortError>;
  listRemoteEndpoints(workingDir: string): Effect.Effect<GitRemoteEndpoint[], GitPortError>;
  listBranches(workingDir: string): Effect.Effect<GitBranch[], GitPortError>;
  listFiles(
    workingDir: string,
    relativePath?: string,
    options?: GitFileListOptions,
  ): Effect.Effect<GitFileListEntry[], GitPortError>;
  getFileTreeContext(
    workingDir: string,
    targetBranch?: string,
  ): Effect.Effect<WorkspaceFileTreeContext, GitPortError>;
  listFileRegions(
    workingDir: string,
    regions: string[],
  ): Effect.Effect<GitFileListEntry[], GitPortError>;
  getCurrentBranch(
    workingDir: string,
    readContext?: GitReadContext,
  ): Effect.Effect<GitCurrentBranch, GitPortError>;
  getStatus(
    workingDir: string,
    readContext?: GitReadContext,
  ): Effect.Effect<GitFileStatus[], GitPortError>;
  listChangedFiles(
    workingDir: string,
    targetBranch: string,
    readContext?: GitReadContext,
  ): Effect.Effect<GitChangedFile[], GitPortError>;
  getDiff(workingDir: string, targetBranch?: string): Effect.Effect<GitFileDiff[], GitPortError>;
  getWorktreeStatusData(
    workingDir: string,
    targetBranch: string,
    diffScope: GitDiffScope,
    readContext?: GitReadContext,
  ): Effect.Effect<GitWorktreeStatusData, GitPortError>;
  getWorktreeStatusSummaryData(
    workingDir: string,
    targetBranch: string,
    diffScope: GitDiffScope,
    readContext?: GitReadContext,
  ): Effect.Effect<GitWorktreeStatusSummaryData, GitPortError>;
  getLocalChanges(
    workingDir: string,
    readContext?: GitReadContext,
  ): Effect.Effect<GitLocalChangesData, GitPortError>;
  /** Applies a selection that the caller validated against `changes`. */
  changeSelection(
    workingDir: string,
    changes: GitLocalChangesData,
    input: GitChangeInput,
  ): Effect.Effect<Pick<GitChangeSelectionResult, "affectedPaths">, GitPortError>;
  getHistoryPage(
    workingDir: string,
    input: GitHistoryPageInput,
  ): Effect.Effect<GitHistoryPage, GitPortError>;
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
    onDeleting?: (branch: { name: string; oid: string }) => void,
  ): Effect.Effect<void, GitPortError>;
  restoreDeletedBranch(
    repoPath: string,
    branch: { name: string; oid: string },
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
  isMergeIncluded(
    repoPath: string,
    sourceBranch: string,
    targetOid: string,
    appliedTargetOid?: string,
  ): Effect.Effect<boolean, GitPortError>;
  mergeBranch(
    workingDir: string,
    request: GitMergeBranchRequest,
  ): Effect.Effect<GitMergeBranchResult, GitPortError>;
  switchBranch(
    workingDir: string,
    branch: string,
    create: boolean,
  ): Effect.Effect<GitCurrentBranch, GitPortError>;
  restoreWorktreeToReference(
    workingDirectory: string,
    reference: string,
  ): Effect.Effect<void, GitPortError>;
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
  commitStaged(
    workingDir: string,
    message: string,
  ): Effect.Effect<GitCommitAllResult, GitPortError>;
  pushBranch(
    workingDir: string,
    branch: string,
    options?: GitPushBranchOptions,
  ): Effect.Effect<GitPushBranchResult, GitPortError>;
  /** An empty destination list updates only the local tracking ref. */
  pushBoundPublication(
    workingDir: string,
    input: { target: BoundGitPublication; destinationIdentities: string[] },
  ): Effect.Effect<GitPublicationProgress, GitPortError>;
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

export class GitPortTag extends Context.Service<GitPortTag, GitPort>()(
  "@openducktor/host/GitPort",
) {}
