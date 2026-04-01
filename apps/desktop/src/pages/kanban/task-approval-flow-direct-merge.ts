import type { TaskApprovalContext } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { GitConflict } from "@/features/agent-studio-git";
import { canonicalTargetBranch, checkoutTargetBranch } from "@/lib/target-branch";
import { host } from "@/state/operations/shared/host";
import {
  invalidateTaskApprovalContextQuery,
  loadTaskApprovalContextFromQuery,
} from "@/state/queries/task-approval";
import type { TaskApprovalFlowReadyState } from "./task-approval-flow-state";

const DIRECT_MERGE_PUSH_FAILURE_MESSAGE = "Git push failed with no output.";

type SubmitDirectMergeApprovalArgs = {
  approval: TaskApprovalFlowReadyState;
  queryClient: QueryClient;
  repoPath: string;
  refreshTasks: () => Promise<void>;
};

type CompleteDirectMergeApprovalArgs = {
  approval: TaskApprovalFlowReadyState;
  repoPath: string;
  refreshTasks: () => Promise<void>;
};

export type SubmitDirectMergeApprovalResult =
  | {
      outcome: "conflicts";
      conflict: GitConflict;
    }
  | {
      outcome: "task_closed";
      successDescription: string;
    }
  | {
      outcome: "await_completion";
      approvalContext: TaskApprovalContext;
    };

const normalizeConflict = (
  conflict: NonNullable<
    Awaited<ReturnType<typeof host.taskDirectMerge>> extends infer TResult
      ? TResult extends { outcome: "conflicts"; conflict: infer TConflict }
        ? TConflict
        : never
      : never
  >,
): GitConflict => ({
  ...conflict,
  currentBranch: conflict.currentBranch ?? null,
  workingDir: conflict.workingDir ?? null,
});

export async function submitDirectMergeApproval({
  approval,
  queryClient,
  repoPath,
  refreshTasks,
}: SubmitDirectMergeApprovalArgs): Promise<SubmitDirectMergeApprovalResult> {
  const approvalContext = approval.approvalContext;
  const directMergeResult = await host.taskDirectMerge(repoPath, approval.taskId, {
    mergeMethod: approval.mergeMethod,
    squashCommitMessage:
      approval.mergeMethod === "squash"
        ? approval.squashCommitMessage.trim() || undefined
        : undefined,
  });

  if (directMergeResult.outcome === "conflicts") {
    return {
      outcome: "conflicts",
      conflict: normalizeConflict(directMergeResult.conflict),
    };
  }

  await refreshTasks();
  if (directMergeResult.task.status === "closed") {
    return {
      outcome: "task_closed",
      successDescription: canonicalTargetBranch(approvalContext.targetBranch),
    };
  }

  await invalidateTaskApprovalContextQuery(queryClient, repoPath, approval.taskId);
  const nextApprovalContext = await loadTaskApprovalContextFromQuery(
    queryClient,
    repoPath,
    approval.taskId,
  );
  if (!nextApprovalContext.directMerge) {
    throw new Error(
      "Local direct merge completed, but the task did not enter a resumable completion state.",
    );
  }

  return {
    outcome: "await_completion",
    approvalContext: nextApprovalContext,
  };
}

export async function completeDirectMergeApproval({
  approval,
  repoPath,
  refreshTasks,
}: CompleteDirectMergeApprovalArgs): Promise<{ successDescription: string }> {
  const approvalContext = approval.approvalContext;
  const publishTarget = approvalContext.publishTarget;

  if (publishTarget) {
    if (!publishTarget.remote) {
      throw new Error("The configured target branch does not have a publish remote.");
    }
    const pushResult = await host.gitPushBranch(repoPath, checkoutTargetBranch(publishTarget), {
      remote: publishTarget.remote,
    });
    if (pushResult.outcome !== "pushed") {
      throw new Error(pushResult.output.trim() || DIRECT_MERGE_PUSH_FAILURE_MESSAGE);
    }
  }

  await host.taskDirectMergeComplete(repoPath, approval.taskId);
  await refreshTasks();

  return {
    successDescription: canonicalTargetBranch(publishTarget ?? approvalContext.targetBranch),
  };
}
