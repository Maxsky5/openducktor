import type { CommitsAheadBehind, FileDiff, FileStatus } from "@openducktor/contracts";

export type DiffScope = "target" | "uncommitted";

export type DiffDataState = {
  branch: string | null;
  worktreePath: string | null;
  targetBranch: string;
  diffScope: DiffScope;
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  fileDiffs: FileDiff[];
  fileStatuses: FileStatus[];
  statusSnapshotKey?: string | null;
  uncommittedFileCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
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

export type AgentStudioRebaseConflictOperation = GitConflictOperation;
export type AgentStudioRebaseConflictAction = GitConflictAction;
export type AgentStudioRebaseConflict = GitConflict;

export type AgentStudioPendingForcePush = {
  remote: string;
  branch: string;
  output: string;
};

export type AgentStudioPendingPullRebase = {
  branch: string;
  localAhead: number;
  upstreamBehind: number;
};
