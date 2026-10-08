import type { GitConflict, GitConflictOperation } from "@/features/agent-studio-git";

type GitConflictCopy = {
  title: string;
  inProgressLabel: string;
  operationLabel: string;
  abortLabel: string;
  abortedToastTitle: string;
  abortFailureTitle: string;
  builderSuccessTitle: string;
  builderFailureMessage: string;
};

const COPY_BY_OPERATION = {
  rebase: {
    title: "Rebase conflict detected",
    inProgressLabel: "Rebase in progress",
    operationLabel: "rebase",
    abortLabel: "Abort rebase",
    abortedToastTitle: "Rebase aborted",
    abortFailureTitle: "Failed to abort rebase",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
  pull_rebase: {
    title: "Pull with rebase conflict detected",
    inProgressLabel: "Pull with rebase in progress",
    operationLabel: "pull with rebase",
    abortLabel: "Abort rebase",
    abortedToastTitle: "Rebase aborted",
    abortFailureTitle: "Failed to abort rebase",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
  direct_merge_merge_commit: {
    title: "Direct merge conflict detected",
    inProgressLabel: "Direct merge in progress",
    operationLabel: "direct merge with a merge commit",
    abortLabel: "Abort merge",
    abortedToastTitle: "Merge aborted",
    abortFailureTitle: "Failed to abort merge",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
  direct_merge_squash: {
    title: "Direct squash merge conflict detected",
    inProgressLabel: "Direct squash merge in progress",
    operationLabel: "direct squash merge",
    abortLabel: "Abort merge",
    abortedToastTitle: "Merge aborted",
    abortFailureTitle: "Failed to abort merge",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
  direct_merge_rebase: {
    title: "Direct rebase merge conflict detected",
    inProgressLabel: "Direct rebase merge in progress",
    operationLabel: "direct merge with rebase",
    abortLabel: "Abort rebase",
    abortedToastTitle: "Rebase aborted",
    abortFailureTitle: "Failed to abort rebase",
    builderSuccessTitle: "Sent git conflict resolution request to Builder",
    builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
  },
} satisfies Record<GitConflictOperation, GitConflictCopy>;

export const getGitConflictCopy = (operation: GitConflictOperation | null): GitConflictCopy =>
  operation === null
    ? {
        title: "Git conflict operation unavailable",
        inProgressLabel: "Git conflict detected",
        operationLabel: "unidentified Git operation",
        abortLabel: "Abort unavailable",
        abortedToastTitle: "Git operation aborted",
        abortFailureTitle: "Failed to abort Git operation",
        builderSuccessTitle: "Sent git conflict resolution request to Builder",
        builderFailureMessage: "Failed to contact Builder for git conflict resolution.",
      }
    : COPY_BY_OPERATION[operation];

export const getGitConflictTitle = (conflict: GitConflict): string =>
  getGitConflictCopy(conflict.operation).title;
