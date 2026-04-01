import type { GitConflict } from "@/features/agent-studio-git";
import { host } from "@/state/operations/shared/host";

export const abortTaskApprovalGitConflict = (repoPath: string, conflict: GitConflict) =>
  host.gitAbortConflict(repoPath, conflict.operation, conflict.workingDir ?? undefined);

export const askBuilderToResolveTaskApprovalGitConflict = (
  conflict: GitConflict,
  taskId: string,
  onResolveGitConflict: (conflict: GitConflict, taskId: string) => Promise<boolean>,
): Promise<boolean> => onResolveGitConflict(conflict, taskId);
