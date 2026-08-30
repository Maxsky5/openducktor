import type { GitConflictOperation, GitDiffRefresh } from "@/features/agent-studio-git";
import { getGitConflictCopy } from "@/features/git-conflict-resolution";
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

export const toConflictMessage = (
  conflictedFiles: string[],
  operation: GitConflictOperation,
): string => {
  const action = getGitConflictCopy(operation).title.replace(" conflict detected", "");
  return conflictedFiles.length > 0
    ? `${action} stopped due to conflicts in: ${conflictedFiles.join(", ")}.`
    : `${action} stopped due to conflicts.`;
};
