import { detectedGitConflict } from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import type { DiffDataState, GitConflict } from "@openducktor/frontend-core/git/contracts";
import { collectUnmergedFilePaths } from "@openducktor/frontend-core/git/model/unmerged-file-paths";
import { isOutcomeUnknown } from "@openducktor/frontend-core/lib/command-outcome";

/**
 * The Git Conflict that the Changes view shows: the conflict that Git reports, or the unmerged
 * files when Git reports no operation.
 */
export const activeGitConflict = (diffData: DiffDataState): GitConflict | null =>
  diffData.gitConflict ??
  detectedGitConflict({
    branch: diffData.branch,
    conflictedFiles: collectUnmergedFilePaths(diffData.fileStatuses),
    workingDir: diffData.worktreePath,
  });

/** The host guidance of a command whose result was lost, or null for other failures. */
export const unknownOutcomeGuidance = (cause: unknown): string | null =>
  isOutcomeUnknown(cause) ? cause.failure.nextAction : null;
