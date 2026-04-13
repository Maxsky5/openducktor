import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitResetWorktreeSelection,
} from "@openducktor/contracts";

export type DiffScope = "target" | "uncommitted";

export type GitDiffRefreshMode = "hard" | "soft" | "scheduled";

export type GitDiffRefresh = (mode?: GitDiffRefreshMode) => Promise<void>;

export type DiffScopeState = {
  branch: string | null;
  fileDiffs: FileDiff[];
  fileStatuses: FileStatus[];
  uncommittedFileCount: number;
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  error: string | null;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
};

export type DiffDataState = {
  branch: string | null;
  worktreePath: string | null;
  targetBranch: string;
  diffScope: DiffScope;
  scopeStatesByScope: Record<DiffScope, DiffScopeState>;
  loadedScopesByScope: Record<DiffScope, boolean>;
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  fileDiffs: FileDiff[];
  fileStatuses: FileStatus[];
  statusSnapshotKey?: string | null;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
  uncommittedFileCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: GitDiffRefresh;
  setDiffScope: (scope: DiffScope) => void;
};

export type GitConflictOperation =
  | "rebase"
  | "pull_rebase"
  | "direct_merge_merge_commit"
  | "direct_merge_squash"
  | "direct_merge_rebase";

export type GitConflictAction = "abort" | "ask_builder" | null;

export type GitConflict = {
  operation: GitConflictOperation;
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

export type AgentStudioPendingReset = GitResetWorktreeSelection;
