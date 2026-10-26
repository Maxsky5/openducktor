import type { GitConflict, GitConflictOperation } from "../contracts";

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

/** Why Abort cannot run: Git did not report the operation or the directory of the conflict. */
export const CONFLICT_ABORT_UNAVAILABLE_MESSAGE =
  "Restore the Git conflict operation and directory before aborting.";

/** The title of a failed Git refresh after a successful abort. */
export const CONFLICT_ABORT_REFRESH_FAILED_TITLE = "Conflict aborted but refresh failed";

/** Why an agent cannot receive a conflict whose operation Git did not report. */
export const UNIDENTIFIED_GIT_CONFLICT_ASK_BLOCKED_REASON =
  "Git did not report the conflict operation. Restore the operation information before asking for assistance.";

/** The output of a conflict whose operation Git did not report. */
export const UNIDENTIFIED_GIT_CONFLICT_OUTPUT =
  "Git did not report the conflict operation. Restore the operation information before asking for assistance or aborting.";

/** The description of a conflict whose operation Git did not report. */
export const UNIDENTIFIED_GIT_CONFLICT_DESCRIPTION =
  "Git reports unmerged files. Restore the operation information before asking for assistance or aborting.";

/**
 * The conflict that unmerged files show when Git reports no conflict operation, or null when no
 * file is unmerged.
 */
export const detectedGitConflict = ({
  branch,
  conflictedFiles,
  workingDir,
}: {
  branch: string | null;
  conflictedFiles: string[];
  workingDir: string | null;
}): GitConflict | null =>
  conflictedFiles.length > 0
    ? {
        operation: null,
        currentBranch: branch,
        targetBranch: "",
        conflictedFiles,
        output: UNIDENTIFIED_GIT_CONFLICT_OUTPUT,
        workingDir,
      }
    : null;

/** A plain sentence that tells which operation waits on conflicts. */
export const gitConflictDescription = (conflict: GitConflict): string => {
  if (!conflict.operation) return UNIDENTIFIED_GIT_CONFLICT_DESCRIPTION;
  const { operationLabel } = getGitConflictCopy(conflict.operation);
  const onto = conflict.targetBranch ? ` onto ${conflict.targetBranch}` : "";
  return `The ${operationLabel}${onto} is still paused on conflicts.`;
};
