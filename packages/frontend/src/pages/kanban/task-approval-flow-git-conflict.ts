import type { GitConflictAssistanceResult } from "@/features/git-conflict-resolution/conflict-assistance";
import type { GitConflict } from "@/features/agent-studio-git";
import { host } from "@/state/operations/shared/host";

export const abortTaskApprovalGitConflict = (repoPath: string, conflict: GitConflict) => {
  if (!conflict.operation || !conflict.workingDir)
    throw new Error("Restore the conflict operation and directory before aborting.");
  return host.gitAbortConflict(repoPath, conflict.operation, conflict.workingDir);
};

export const askBuilderToResolveTaskApprovalGitConflict = (
  conflict: GitConflict,
  taskId: string,
  onResolveGitConflict: (
    conflict: GitConflict,
    taskId: string,
  ) => Promise<GitConflictAssistanceResult>,
): Promise<GitConflictAssistanceResult> => onResolveGitConflict(conflict, taskId);
