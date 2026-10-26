import type { HostClient } from "@openducktor/host-client";
import type { GitConflict, GitConflictOperation } from "../contracts";
import { getGitConflictCopy } from "./conflict-copy";

/** A Git Conflict that names its operation and directory, so Abort can run. */
export type AbortableGitConflict = GitConflict & {
  operation: GitConflictOperation;
  workingDir: string;
};

export const isAbortableGitConflict = (conflict: GitConflict): conflict is AbortableGitConflict =>
  conflict.operation !== null && Boolean(conflict.workingDir);

/** The result of an Abort, with the title of its feedback. */
export type GitConflictAbortResult =
  | { kind: "aborted"; title: string }
  | { kind: "failed"; title: string; error: unknown };

/** Aborts the Git operation of a conflict in the directory where it stopped. */
export const abortGitConflict = async (
  host: Pick<HostClient, "gitAbortConflict">,
  repoPath: string,
  conflict: AbortableGitConflict,
): Promise<GitConflictAbortResult> => {
  const copy = getGitConflictCopy(conflict.operation);
  try {
    await host.gitAbortConflict(repoPath, conflict.operation, conflict.workingDir);
  } catch (error) {
    return { kind: "failed", title: copy.abortFailureTitle, error };
  }
  return { kind: "aborted", title: copy.abortedToastTitle };
};
