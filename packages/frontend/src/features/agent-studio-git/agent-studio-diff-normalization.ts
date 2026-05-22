import type {
  CommitsAheadBehind,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
} from "@openducktor/contracts";
import type { ScopeSnapshot, ScopeSummaryFields } from "./agent-studio-diff-data-model";
import type { GitConflict } from "./contracts";

const toGitConflict = (
  conflict: GitWorktreeStatus["gitConflict"] | GitWorktreeStatusSummary["gitConflict"],
): GitConflict | null => {
  if (!conflict) {
    return null;
  }

  return {
    operation: conflict.operation,
    currentBranch: conflict.currentBranch ?? null,
    targetBranch: conflict.targetBranch,
    conflictedFiles: conflict.conflictedFiles,
    output: conflict.output,
    workingDir: conflict.workingDir ?? null,
  };
};

const toUpstreamState = (
  upstreamAheadBehind: GitWorktreeStatus["upstreamAheadBehind"],
): {
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  error: string | null;
} => {
  if (upstreamAheadBehind.outcome === "tracking") {
    return {
      upstreamAheadBehind: {
        ahead: upstreamAheadBehind.ahead,
        behind: upstreamAheadBehind.behind,
      },
      upstreamStatus: "tracking",
      error: null,
    };
  }

  if (upstreamAheadBehind.outcome === "untracked") {
    return {
      upstreamAheadBehind: {
        ahead: upstreamAheadBehind.ahead,
        behind: 0,
      },
      upstreamStatus: "untracked",
      error: null,
    };
  }

  return {
    upstreamAheadBehind: null,
    upstreamStatus: "error",
    error: `Upstream status unavailable: ${upstreamAheadBehind.message}`,
  };
};

export const toScopeSnapshot = (snapshot: GitWorktreeStatus): ScopeSnapshot => {
  const { upstreamAheadBehind, upstreamStatus, error } = toUpstreamState(
    snapshot.upstreamAheadBehind,
  );
  return {
    branch: snapshot.currentBranch.name ?? null,
    gitConflict: toGitConflict(snapshot.gitConflict),
    fileDiffs: snapshot.fileDiffs,
    fileStatuses: snapshot.fileStatuses,
    uncommittedFileCount: snapshot.fileStatuses.length,
    commitsAheadBehind: snapshot.targetAheadBehind,
    upstreamAheadBehind,
    upstreamStatus,
    error,
    hashVersion: snapshot.snapshot.hashVersion,
    statusHash: snapshot.snapshot.statusHash,
    diffHash: snapshot.snapshot.diffHash,
  };
};

export const toScopeSummaryFields = (summary: GitWorktreeStatusSummary): ScopeSummaryFields => {
  const { upstreamAheadBehind, upstreamStatus, error } = toUpstreamState(
    summary.upstreamAheadBehind,
  );
  return {
    branch: summary.currentBranch.name ?? null,
    gitConflict: toGitConflict(summary.gitConflict),
    uncommittedFileCount: summary.fileStatusCounts.total,
    commitsAheadBehind: summary.targetAheadBehind,
    upstreamAheadBehind,
    upstreamStatus,
    error,
    hashVersion: summary.snapshot.hashVersion,
    statusHash: summary.snapshot.statusHash,
    diffHash: summary.snapshot.diffHash,
  };
};
