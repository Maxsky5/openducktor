import type { GitConflictAssistanceResult } from "../../git/conflicts/conflict-assistance";
import type { GitConflict } from "../../git/contracts";
export const askBuilderToResolveTaskApprovalGitConflict = (
  conflict: GitConflict,
  taskId: string,
  onResolveGitConflict: (
    conflict: GitConflict,
    taskId: string,
  ) => Promise<GitConflictAssistanceResult>,
): Promise<GitConflictAssistanceResult> => onResolveGitConflict(conflict, taskId);
