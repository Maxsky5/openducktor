import type {
  CommitsAheadBehind,
  GitFileDiff,
  FileStatus,
  GitChangeAction,
  GitChangeGroup,
  GitChangeSelection,
  GitCurrentBranch,
  GitLocalChanges,
} from "@openducktor/contracts";

export type DiffScope = "target" | "uncommitted";

/** `hard` is the manual Refresh. `soft` follows a change. `scheduled` follows a return to the app. */
export type GitDiffRefreshMode = "hard" | "soft" | "scheduled";

export type GitDiffRefresh = (mode: GitDiffRefreshMode) => Promise<void>;

export type DiffScopeState = {
  branch: string | null;
  /** Staged, unstaged, and conflicted groups. Only the uncommitted scope reads them. */
  localChanges: GitLocalChanges | null;
  gitConflict?: GitConflict | null;
  fileDiffs: GitFileDiff[];
  fileStatuses: FileStatus[];
  uncommittedFileCount: number;
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  upstreamError?: string | null;
  error: string | null;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
};

/** The Git data of one panel. Local fields come from the uncommitted scope. */
export type DiffDataState = {
  /** The repository that the reads use, or null while reads are blocked. */
  repoPath?: string | null;
  branch: string | null;
  branchKnown?: boolean;
  /** The confirmed checkout. History reads only this commit. */
  checkout?: GitCurrentBranch | null;
  worktreePath: string | null;
  /** The label of the comparison target. */
  targetBranch: string;
  /** The checked comparison reference. Branch changes and History show only when it is set. */
  comparisonReference?: string | null;
  comparisonPending?: boolean;
  comparisonUnavailableReason?: string | null;
  gitConflict?: GitConflict | null;
  scopeStatesByScope: Record<DiffScope, DiffScopeState>;
  loadedScopesByScope: Record<DiffScope, boolean>;
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  upstreamError?: string | null;
  fileStatuses: FileStatus[];
  statusSnapshotKey?: string | null;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
  uncommittedFileCount: number;
  isLoading: boolean;
};

export type GitConflictOperation =
  | "rebase"
  | "pull_rebase"
  | "direct_merge_merge_commit"
  | "direct_merge_squash"
  | "direct_merge_rebase";

export type GitConflictAction = "abort" | "ask_builder" | null;

export type GitConflict = {
  operation: GitConflictOperation | null;
  currentBranch: string | null;
  targetBranch: string;
  conflictedFiles: string[];
  output: string;
  workingDir: string | null;
};

export type AgentStudioPendingForcePush = {
  remote: string;
  branch: string;
  output: string;
  repoPath: string;
  workingDir: string | null;
};

export type AgentStudioPendingPullRebase = {
  branch: string;
  localAhead: number;
  upstreamBehind: number;
};

/** A stage, unstage, or discard request for one file, one chunk, or a whole group. */
export type GitChangeIntent = {
  action: GitChangeAction;
  group: GitChangeGroup;
  selection: GitChangeSelection;
};

/** A discard that waits for confirmation. It keeps the content that the user reviewed. */
export type AgentStudioPendingDiscard = {
  group: GitChangeGroup;
  selection: Exclude<GitChangeSelection, { kind: "all" }>;
  isUntrackedFile: boolean;
};

/** Staged commits only the index. All stages every eligible change first. */
export type GitCommitMode = "staged" | "all";
