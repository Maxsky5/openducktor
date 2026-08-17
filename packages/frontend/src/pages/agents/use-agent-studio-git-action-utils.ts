import type { GitConflictOperation, GitDiffRefresh } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "@/features/git-conflict-resolution";

export type GitActionKind = "commit" | "push" | "rebase";

export type RefreshGitDiffData = GitDiffRefresh;

export const CONFLICT_LOCK_REASON = "Git actions are disabled while git conflicts are unresolved.";

export const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
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
