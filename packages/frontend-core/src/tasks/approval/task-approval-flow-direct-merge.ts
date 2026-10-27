import { taskStatusSchema } from "@openducktor/contracts";
import type { TaskApprovalContext } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { GitConflict } from "../../git/contracts";
import { canonicalTargetBranch } from "../../lib/target-branch";
import { runTaskMutationWithChatDraftCleanup } from "../operations/task-chat-draft-cleanup";
import {
  invalidateTaskApprovalContextQuery,
  loadTaskApprovalContextFromQuery,
} from "../../queries/task-approval";
import type { TaskApprovalFlowReadyState } from "./task-approval-flow-state";
import { connectionHost } from "../../connection/client-connection";
import type { HostClient } from "@openducktor/host-client";

type DirectMergeApprovalArgs = {
  approval: TaskApprovalFlowReadyState;
  queryClient: QueryClient;
  repoPath: string;
  refreshTasks: () => Promise<void>;
  workspaceId: string | null;
  /** The close that the merge completes removes the task worktree and its local branch. */
  removeWorktree: boolean;
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
    Awaited<ReturnType<HostClient["taskDirectMerge"]>> extends infer TResult
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
  workspaceId,
  removeWorktree,
}: DirectMergeApprovalArgs): Promise<SubmitDirectMergeApprovalResult> {
  const host = connectionHost(queryClient);
  const approvalContext = approval.approvalContext;
  const directMergeResult = await runTaskMutationWithChatDraftCleanup({
    agentSessionReadPort: host,
    queryClient,
    repoPath,
    workspaceId,
    taskIds: [approval.taskId],
    mutation: async () =>
      host.taskDirectMerge(repoPath, approval.taskId, {
        expected: {
          taskStatus: taskStatusSchema.parse(approvalContext.taskStatus),
          sourceBranch: approvalContext.sourceBranch,
          targetBranch: approvalContext.targetBranch,
        },
        mergeMethod: approval.mergeMethod,
        squashCommitMessage:
          approval.mergeMethod === "squash"
            ? approval.squashCommitMessage.trim() || undefined
            : undefined,
        removeWorktree,
      }),
    shouldCleanup: (result) => result.outcome !== "conflicts" && result.task.status === "closed",
  });

  if (directMergeResult.outcome === "conflicts") {
    return {
      outcome: "conflicts",
      conflict: normalizeConflict(directMergeResult.conflict),
    };
  }

  if (directMergeResult.task.status === "closed") {
    await refreshTasks();
    return {
      outcome: "task_closed",
      successDescription: canonicalTargetBranch(approvalContext.targetBranch),
    };
  }

  await Promise.all([
    refreshTasks(),
    invalidateTaskApprovalContextQuery(queryClient, repoPath, approval.taskId),
  ]);
  const nextApprovalContext = await loadTaskApprovalContextFromQuery(
    queryClient,
    repoPath,
    approval.taskId,
  );
  if (nextApprovalContext.outcome !== "ready") {
    throw new Error(
      "Local direct merge completed, but the builder worktree disappeared before completion could resume.",
    );
  }

  const resumedApprovalContext = nextApprovalContext.approvalContext;
  if (!resumedApprovalContext.directMerge) {
    throw new Error(
      "Local direct merge completed, but the task did not enter a resumable completion state.",
    );
  }

  return {
    outcome: "await_completion",
    approvalContext: resumedApprovalContext,
  };
}

export async function completeDirectMergeApproval({
  approval,
  queryClient,
  repoPath,
  refreshTasks,
  workspaceId,
  removeWorktree,
}: DirectMergeApprovalArgs): Promise<{ successDescription: string }> {
  const host = connectionHost(queryClient);
  const approvalContext = approval.approvalContext;
  const publishTarget = approvalContext.publishTarget;

  await runTaskMutationWithChatDraftCleanup({
    agentSessionReadPort: host,
    queryClient,
    repoPath,
    workspaceId,
    taskIds: [approval.taskId],
    mutation: async () => {
      let publicationConsent: Parameters<HostClient["taskDirectMergeComplete"]>[3];
      if (publishTarget) {
        if (!approvalContext.directMerge || !approvalContext.publicationPreview)
          throw new Error(
            "Publication context is missing. Refresh approval context before choosing Publish and complete.",
          );
        publicationConsent = {
          expectedMerge: approvalContext.directMerge,
          expectedPublication: approvalContext.publicationPreview,
        };
      }
      await host.taskDirectMergeComplete(
        repoPath,
        approval.taskId,
        removeWorktree,
        publicationConsent,
      );
    },
  });
  await refreshTasks();

  return {
    successDescription: canonicalTargetBranch(publishTarget ?? approvalContext.targetBranch),
  };
}
