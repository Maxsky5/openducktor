import type { GitWorktreeStatus, GitWorktreeStatusSummary } from "@openducktor/contracts";
import type { GitConflict } from "../contracts";
import type { ScopeSnapshot, ScopeSummaryFields } from "./diff-data-model";

type UpstreamState = Pick<
  ScopeSummaryFields,
  "upstreamAheadBehind" | "upstreamStatus" | "upstreamError" | "error"
>;

const toGitConflict = (
  conflict: GitWorktreeStatus["gitConflict"] | GitWorktreeStatusSummary["gitConflict"],
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

export const toScopeSnapshot = (snapshot: GitWorktreeStatus): ScopeSnapshot => {
  const { upstreamAheadBehind, upstreamStatus, upstreamError, error } = toUpstreamState(
    snapshot.upstreamAheadBehind,
  );
  return {
    branch: snapshot.currentBranch.name ?? null,
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

export const toScopeSummaryFields = (summary: GitWorktreeStatusSummary): ScopeSummaryFields => {
  const { upstreamAheadBehind, upstreamStatus, upstreamError, error } = toUpstreamState(
    summary.upstreamAheadBehind,
  );
  return {
    branch: summary.currentBranch.name ?? null,
    gitConflict: toGitConflict(summary.gitConflict, summary.snapshot.effectiveWorkingDir),
    uncommittedFileCount: summary.fileStatusCounts.total,
    commitsAheadBehind: summary.targetAheadBehind,
    upstreamAheadBehind,
    upstreamStatus,
    upstreamError: upstreamError ?? null,
    error,
    hashVersion: summary.snapshot.hashVersion,
    statusHash: summary.snapshot.statusHash,
    diffHash: summary.snapshot.diffHash,
  };
};
