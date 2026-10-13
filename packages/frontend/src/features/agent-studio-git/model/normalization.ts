import type { GitLocalChanges, GitWorktreeStatus } from "@openducktor/contracts";
import type { DiffScopeState, GitConflict } from "../contracts";

type UpstreamState = Pick<
  DiffScopeState,
  "upstreamAheadBehind" | "upstreamStatus" | "upstreamError" | "error"
>;

const toGitConflict = (
  conflict: GitWorktreeStatus["gitConflict"],
  effectiveWorkingDir: string,
): GitConflict | null => {
  if (!conflict) {
    return null;
  }

  return {
    operation: conflict.operation,
    currentBranch: conflict.currentBranch ?? null,
    // Git status supplies the comparison target, not the interrupted operation's target.
    targetBranch: "",
    conflictedFiles: conflict.conflictedFiles,
    output: conflict.output,
    workingDir: conflict.workingDir ?? effectiveWorkingDir,
  };
};

const toUpstreamState = (
  upstreamAheadBehind: GitWorktreeStatus["upstreamAheadBehind"],
): UpstreamState => {
  if (upstreamAheadBehind.outcome === "tracking") {
    return {
      upstreamAheadBehind: {
        ahead: upstreamAheadBehind.ahead,
        behind: upstreamAheadBehind.behind,
      },
      upstreamStatus: "tracking",
      upstreamError: null,
      error: null,
    };
  }

  if (upstreamAheadBehind.outcome === "untracked") {
    return {
      upstreamAheadBehind: null,
      upstreamStatus: "untracked",
      upstreamError: null,
      error: null,
    };
  }

  return {
    upstreamAheadBehind: null,
    upstreamStatus: "error",
    upstreamError: upstreamAheadBehind.message,
    error: null,
  };
};

export const toScopeSnapshot = (snapshot: GitWorktreeStatus): DiffScopeState => {
  const { upstreamAheadBehind, upstreamStatus, upstreamError, error } = toUpstreamState(
    snapshot.upstreamAheadBehind,
  );
  return {
    branch: snapshot.currentBranch.name ?? null,
    localChanges: null,
    gitConflict: toGitConflict(snapshot.gitConflict, snapshot.snapshot.effectiveWorkingDir),
    fileDiffs: snapshot.fileDiffs,
    fileStatuses: snapshot.fileStatuses,
    uncommittedFileCount: snapshot.fileStatuses.length,
    commitsAheadBehind: snapshot.targetAheadBehind,
    upstreamAheadBehind,
    upstreamStatus,
    upstreamError: upstreamError ?? null,
    error,
    hashVersion: snapshot.snapshot.hashVersion,
    statusHash: snapshot.snapshot.statusHash,
    diffHash: snapshot.snapshot.diffHash,
  };
};

/** The uncommitted scope. Its file list holds every local group, so comment checks see each path. */
export const toLocalScopeSnapshot = (changes: GitLocalChanges): DiffScopeState => {
  const { upstreamAheadBehind, upstreamStatus, upstreamError, error } = toUpstreamState(
    changes.upstreamAheadBehind,
  );
  return {
    branch: changes.currentBranch.name ?? null,
    localChanges: changes,
    gitConflict: toGitConflict(changes.gitConflict, changes.snapshot.effectiveWorkingDir),
    fileDiffs: [
      ...changes.unstaged.fileDiffs,
      ...changes.staged.fileDiffs,
      ...changes.conflicted.fileDiffs,
    ],
    fileStatuses: changes.fileStatuses,
    uncommittedFileCount: changes.fileStatuses.length,
    commitsAheadBehind: { ahead: 0, behind: 0 },
    upstreamAheadBehind,
    upstreamStatus,
    upstreamError: upstreamError ?? null,
    error,
    hashVersion: changes.snapshot.hashVersion,
    statusHash: changes.snapshot.statusHash,
    diffHash: changes.snapshot.diffHash,
  };
};
