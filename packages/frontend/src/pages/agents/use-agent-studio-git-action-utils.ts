import type {
  GitConflictOperation,
  GitDiffRefresh,
} from "@openducktor/frontend-core/git/contracts";
import { getGitConflictCopy } from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import { z } from "zod";

export type GitActionKind = "commit" | "push" | "rebase";

export type RefreshGitDiffData = GitDiffRefresh;

export const CONFLICT_LOCK_REASON = "Git actions are disabled while git conflicts are unresolved.";

export const toErrorMessage = (cause: unknown, fallback: string): string => {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  const stringCause = z.string().safeParse(cause);
  if (stringCause.success && stringCause.data.trim().length > 0) {
    return stringCause.data;
  }
  return fallback;
};

/**
 * Reads the panel again after Git confirmed an action. A failed read does not undo the action, so
 * the message keeps the confirmed result and asks for Refresh. It is null when the read succeeds.
 */
export const refreshAfterGitAction = async (
  refreshDiffData: RefreshGitDiffData,
  confirmedResult: string,
): Promise<string | null> => {
  try {
    await refreshDiffData("soft");
    return null;
  } catch (error) {
    return `${confirmedResult}, but the panel could not update: ${toErrorMessage(error, "Unknown error.")} Refresh to try again.`;
  }
};

export const toConflictMessage = (
  conflictedFiles: string[],
  operation: GitConflictOperation,
): string => {
  const action = getGitConflictCopy(operation).title.replace(" conflict detected", "");
  return conflictedFiles.length > 0
    ? `${action} stopped due to conflicts in: ${conflictedFiles.join(", ")}.`
    : `${action} stopped due to conflicts.`;
};
