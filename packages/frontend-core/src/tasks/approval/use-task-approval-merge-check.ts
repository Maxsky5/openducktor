import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useActiveWorkspaceContext } from "../../app-state/app-state-contexts";
import { errorMessage } from "../../lib/errors";
import { checkTaskMergeStatus } from "../../queries/task-merge-status";
import { invalidateTaskWorktreeCleanupImpact } from "../../queries/task-worktree-cleanup-impact";
import type { TaskMergeStatusView } from "../presentation/task-merge-status";

/** The Check again control of the merge status in the approval close view. */
export type TaskCloseMergeCheck = {
  onCheckAgain: () => void;
  isChecking: boolean;
  error: string | null;
};

/**
 * Check again fetches and runs merge detection for the whole workspace. The confirmation compares
 * the result with the current branch tip, so the check then reads that tip again.
 */
export function useTaskApprovalMergeCheck(taskId: string): TaskCloseMergeCheck | undefined {
  const queryClient = useQueryClient();
  const repoPath = useActiveWorkspaceContext().activeWorkspace?.repoPath ?? null;
  const check = useMutation({
    mutationFn: async (checkedRepoPath: string): Promise<void> => {
      await checkTaskMergeStatus(queryClient, checkedRepoPath);
      await invalidateTaskWorktreeCleanupImpact(queryClient, checkedRepoPath, taskId);
    },
  });
  if (repoPath === null) return undefined;
  return {
    onCheckAgain: () => check.mutate(repoPath),
    isChecking: check.isPending,
    error: check.error ? errorMessage(check.error) : null,
  };
}

/**
 * The merge status that a close view shows. A check reads the merge status and the branch tip, and
 * they change at different times. The status at the start of the check stays until both reads end,
 * so the view does not flicker.
 */
export function useMergeStatusDuringCheck(
  status: TaskMergeStatusView,
  mergeCheck: TaskCloseMergeCheck | undefined,
) {
  const [statusAtCheck, setStatusAtCheck] = useState<TaskMergeStatusView | null>(null);
  const isChecking = mergeCheck?.isChecking === true;
  return {
    shown: isChecking && statusAtCheck ? statusAtCheck : status,
    isChecking,
    checkAgain: () => {
      setStatusAtCheck(status);
      mergeCheck?.onCheckAgain();
    },
  };
}
