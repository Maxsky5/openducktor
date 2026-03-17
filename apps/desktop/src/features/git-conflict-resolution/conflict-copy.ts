import type { GitConflict, GitConflictOperation } from "@/features/agent-studio-git";

type GitConflictCopy = {
  title: string;
  operationLabel: string;
  abortLabel: string;
  abortedToastTitle: string;
  abortFailureTitle: string;
  builderSuccessTitle: string;
  builderFailureMessage: string;
};

const COPY_BY_OPERATION: Record<GitConflictOperation, GitConflictCopy> = {
  rebase: {
    title: "Rebase conflict detected",
    operationLabel: "rebase",
    abortLabel: "Abort rebase",
    abortedToastTitle: "Rebase aborted",
    abortFailureTitle: "Failed to abort rebase",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
  pull_rebase: {
    title: "Pull with rebase conflict detected",
    operationLabel: "pull with rebase",
    abortLabel: "Abort rebase",
    abortedToastTitle: "Rebase aborted",
    abortFailureTitle: "Failed to abort rebase",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
  direct_merge_merge_commit: {
    title: "Direct merge conflict detected",
    operationLabel: "direct merge with a merge commit",
    abortLabel: "Abort merge",
    abortedToastTitle: "Merge aborted",
    abortFailureTitle: "Failed to abort merge",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
  direct_merge_squash: {
    title: "Direct squash merge conflict detected",
    operationLabel: "direct squash merge",
    abortLabel: "Abort merge",
    abortedToastTitle: "Merge aborted",
    abortFailureTitle: "Failed to abort merge",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
  direct_merge_rebase: {
    title: "Direct rebase merge conflict detected",
    operationLabel: "direct merge with rebase",
    abortLabel: "Abort rebase",
    abortedToastTitle: "Rebase aborted",
    abortFailureTitle: "Failed to abort rebase",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
};

export const getGitConflictCopy = (operation: GitConflictOperation): GitConflictCopy =>
  COPY_BY_OPERATION[operation];

export const getGitConflictTitle = (conflict: GitConflict): string =>
  getGitConflictCopy(conflict.operation).title;
