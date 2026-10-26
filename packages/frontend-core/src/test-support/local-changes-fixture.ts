import type { GitLocalChanges, GitWorktreeStatus } from "@openducktor/contracts";

/** The local group view of a HEAD status fixture. Its staged group holds the staged statuses. */
export const toLocalChanges = (status: GitWorktreeStatus): GitLocalChanges => {
  const groupSnapshot = {
    hashVersion: 2,
    statusHash: status.snapshot.statusHash,
    diffHash: status.snapshot.diffHash,
  };
  const changes: GitLocalChanges = {
    currentBranch: status.currentBranch,
    fileStatuses: status.fileStatuses,
    unstaged: {
      fileStatuses: status.fileStatuses.filter((entry) => !entry.staged),
      fileDiffs: status.fileDiffs,
      snapshot: groupSnapshot,
    },
    staged: {
      fileStatuses: status.fileStatuses.filter((entry) => entry.staged),
      fileDiffs: [],
      snapshot: groupSnapshot,
    },
    conflicted: { fileStatuses: [], fileDiffs: [] },
    upstreamAheadBehind: status.upstreamAheadBehind,
    snapshot: status.snapshot,
  };
  if (status.gitConflict) changes.gitConflict = status.gitConflict;
  return changes;
};
