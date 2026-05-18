import type { GitConflict, GitMergeMethod, TaskApprovalContext } from "@openducktor/contracts";
import { canonicalTargetBranch, checkoutBranch } from "./task-branch-policy";
import { TaskPolicyError } from "./task-policy-error";

export const ensureCleanBuilderWorktree = (approval: TaskApprovalContext): void => {
  if (!approval.hasUncommittedChanges) {
    return;
  }

  const fileLabel =
    approval.uncommittedFileCount === 1
      ? "1 uncommitted file"
      : `${approval.uncommittedFileCount} uncommitted files`;
  const pronoun = approval.uncommittedFileCount === 1 ? "it" : "them";
  throw new TaskPolicyError(
    `Human approval is blocked because the builder worktree has ${fileLabel}. Commit or discard ${pronoun} before merging or opening a pull request.`,
  );
};

export const directMergeConflict = (
  repoPath: string,
  approval: TaskApprovalContext,
  method: GitMergeMethod,
  conflictedFiles: string[],
  output: string,
): GitConflict => {
  if (method === "merge_commit") {
    return {
      operation: "direct_merge_merge_commit",
      currentBranch: checkoutBranch(approval.targetBranch),
      targetBranch: canonicalTargetBranch(approval.targetBranch),
      conflictedFiles,
      output,
      workingDir: repoPath,
    };
  }
  if (method === "squash") {
    return {
      operation: "direct_merge_squash",
      currentBranch: checkoutBranch(approval.targetBranch),
      targetBranch: canonicalTargetBranch(approval.targetBranch),
      conflictedFiles,
      output,
      workingDir: repoPath,
    };
  }

  return {
    operation: "direct_merge_rebase",
    currentBranch: approval.sourceBranch,
    targetBranch: canonicalTargetBranch(approval.targetBranch),
    conflictedFiles,
    output,
    workingDir: approval.workingDirectory,
  };
};
