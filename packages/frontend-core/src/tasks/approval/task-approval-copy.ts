import type { GitTargetBranch } from "@openducktor/contracts";
import { canonicalTargetBranch } from "../../lib/target-branch";
import type {
  PullRequestDraftMode,
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
  TaskApprovalMode,
} from "./task-approval-types";

type TaskApprovalMergeMethod = TaskApprovalApprovalModalModel["mergeMethod"];

/** A sentence with a branch or path in it. Platforms show `code` in the code font. */
export type TaskApprovalTextWithCode = { before: string; code: string; after: string };

export const TASK_APPROVAL_MODE_OPTIONS: ReadonlyArray<{
  value: TaskApprovalMode;
  label: string;
}> = [
  { value: "direct_merge", label: "Direct Merge" },
  { value: "pull_request", label: "Pull Request" },
];

export const TASK_APPROVAL_MERGE_METHOD_OPTIONS: ReadonlyArray<{
  value: TaskApprovalMergeMethod;
  label: string;
  description: string;
}> = [
  {
    value: "merge_commit",
    label: "Merge Commit",
    description: "Preserve the full branch history with a merge commit.",
  },
  {
    value: "squash",
    label: "Squash",
    description: "Collapse the builder branch into a single commit.",
  },
  {
    value: "rebase",
    label: "Rebase",
    description: "Replay builder commits directly onto the target branch.",
  },
];

export const TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS: ReadonlyArray<{
  value: PullRequestDraftMode;
  label: string;
  description: string;
}> = [
  {
    value: "manual",
    label: "Write Manually",
    description: "Provide the pull request title and description yourself.",
  },
  {
    value: "generate_ai",
    label: "Generate With AI",
    description:
      "Choose a Builder session to fork, then let Builder create or update the pull request automatically.",
  },
];

/** The fixed text of the approval flow. */
export const TASK_APPROVAL_COPY = {
  loadingTitle: "Preparing approval options",
  loadingDescription: "OpenDucktor is loading the builder branch and provider readiness.",
  uncommittedChangesTitle: "Uncommitted changes detected",
  approvalFailedTitle: "Approval failed",
  approvalActionLabel: "Approval Action",
  approvalActionAccessibilityLabel: "Approval action",
  mergeMethodLabel: "Merge Method",
  squashCommitMessageLabel: "Squash Commit Message",
  squashCommitMessagePlaceholder: "e.g. feat: add Microsoft login",
  squashCommitMessageRequired: "Enter the squash commit message before merging locally.",
  pullRequestDraftLabel: "Pull Request Draft",
  pullRequestTitleLabel: "Pull Request Title",
  pullRequestDescriptionLabel: "Pull Request Description",
  generatePullRequestNotice:
    "OpenDucktor will ask you to choose a Builder session to fork, then start PR generation in the shared session-start flow.",
  openExistingPullRequest: "Open existing pull request",
  cancel: "Cancel",
  missingWorktreeTitle: "Builder worktree not found",
  missingWorktreeDescription:
    "OpenDucktor could not load the latest builder worktree for this task. Normal direct merge and pull request approval options are unavailable without that workspace.",
  recoveryFailedTitle: "Recovery action failed",
  nextStepChoiceTitle: "Choose the next step",
  nextStepChoiceDescription:
    "Complete task closes the review and moves this task to Done. Reset implementation opens the existing reset workflow so you can send the task back for more work.",
  resetImplementation: "Reset Implementation",
  completionFailedTitle: "Direct merge completion failed",
  localMergeReadyTitle: "Local merge ready",
  nextStepTitle: "Next step",
  localBranchLabel: "Local Branch",
  remoteToUpdateLabel: "Remote To Update",
  finishLater: "Finish Later",
} as const;

/** The approval modes that the provider supports. A mode that cannot run now is disabled. */
export const taskApprovalModeOptions = (
  model: Pick<TaskApprovalApprovalModalModel, "pullRequestSupported" | "pullRequestAvailable">,
): Array<{ value: TaskApprovalMode; label: string; disabled: boolean }> =>
  TASK_APPROVAL_MODE_OPTIONS.filter(
    (option) => option.value !== "pull_request" || model.pullRequestSupported,
  ).map((option) => ({
    value: option.value,
    label: option.label,
    disabled: option.value === "pull_request" && !model.pullRequestAvailable,
  }));

export const taskApprovalPullRequestUnavailableMessage = (reason: string): string =>
  `Pull request unavailable: ${reason}`;

export const taskApprovalUncommittedChangesMessage = (uncommittedFileCount: number): string =>
  uncommittedFileCount === 1
    ? "The builder worktree has 1 uncommitted file. Commit or discard it before approving this task."
    : `The builder worktree has ${uncommittedFileCount} uncommitted files. Commit or discard them before approving this task.`;

export const taskApprovalSquashCommitHint = (
  targetBranch: GitTargetBranch | null,
): TaskApprovalTextWithCode => ({
  before:
    "OpenDucktor prefills this from the oldest commit unique to the builder branch. Edit it before creating the single squash commit on ",
  code: targetBranch?.branch ?? "the target branch",
  after: ".",
});

/** Why the approval cannot submit now, and the label of its confirm control. */
export const getTaskApprovalSubmitState = (model: TaskApprovalApprovalModalModel) => {
  const hasManualPullRequestValidationError =
    model.mode === "pull_request" &&
    model.pullRequestAvailable &&
    model.pullRequestDraftMode === "manual" &&
    (model.title.trim().length === 0 || model.body.trim().length === 0);
  const hasSquashCommitMessageSubmitError =
    model.mode === "direct_merge" &&
    model.mergeMethod === "squash" &&
    model.squashCommitMessage.trim().length === 0;
  const showSquashCommitMessageValidationError =
    hasSquashCommitMessageSubmitError &&
    (model.hasSuggestedSquashCommitMessage || model.squashCommitMessageTouched);

  let confirmLabel = "Merge Locally";
  if (model.mode === "pull_request" && model.pullRequestDraftMode === "manual") {
    confirmLabel = "Create Pull Request";
  } else if (model.mode === "pull_request") {
    confirmLabel = "Start PR Generation";
  }

  return {
    hasManualPullRequestValidationError,
    hasSquashCommitMessageSubmitError,
    showSquashCommitMessageValidationError,
    confirmDisabled:
      model.isLoading ||
      model.isSubmitting ||
      model.hasUncommittedChanges ||
      (model.mode === "pull_request" && !model.pullRequestAvailable) ||
      hasManualPullRequestValidationError ||
      hasSquashCommitMessageSubmitError,
    confirmLabel,
  } satisfies {
    hasManualPullRequestValidationError: boolean;
    hasSquashCommitMessageSubmitError: boolean;
    showSquashCommitMessageValidationError: boolean;
    confirmDisabled: boolean;
    confirmLabel: string;
  };
};

export const missingBuilderWorktreeConfirmLabel = (isSubmitting: boolean): string =>
  isSubmitting ? "Completing Task" : "Complete Task";

/** Why the direct merge cannot complete from this context, or null when it can. */
export const getDirectMergeCompletionContextError = (
  model: Pick<
    TaskApprovalCompletionModalModel,
    "targetBranch" | "publishTarget" | "publicationPreview"
  >,
): string | null => {
  if (model.targetBranch === null)
    return "Missing target branch for direct-merge completion. Refresh approval context and retry.";
  return model.publishTarget && !model.publicationPreview
    ? "Missing publication destinations. Refresh approval context before publishing."
    : null;
};

export const taskApprovalLocalMergeReadyText = (
  localBranchName: string,
): TaskApprovalTextWithCode => ({
  before: "The direct merge is already applied on this machine for ",
  code: localBranchName,
  after: " on this task.",
});

export const taskApprovalCompletionNextStepText = (
  model: Pick<TaskApprovalCompletionModalModel, "targetBranch" | "publishTarget">,
): TaskApprovalTextWithCode =>
  model.publishTarget
    ? {
        before: "Push ",
        code: canonicalTargetBranch(model.publishTarget),
        after:
          " to publish the merged target branch, then move the task to Done and clean up the builder workspace.",
      }
    : {
        before:
          "Move the task to Done and clean up the builder workspace. The merge is already applied locally on ",
        code: model.targetBranch?.branch ?? "",
        after: ".",
      };

export const taskApprovalPublicationCommitLabel = (sourceOid: string): string =>
  `Commit ${sourceOid.slice(0, 12)}`;

export const directMergeCompletionButtonLabel = (
  model: Pick<TaskApprovalCompletionModalModel, "isSubmitting" | "publishTarget">,
): string => {
  const publishTargetBranchName = model.publishTarget?.branch ?? "";
  if (model.isSubmitting && model.publishTarget) return `Publishing ${publishTargetBranchName}`;
  if (model.isSubmitting) return "Completing Direct Merge";
  if (model.publishTarget) return `Push ${publishTargetBranchName} And Mark Done`;
  return "Mark Task Done";
};

export const directMergeCompletionStageDescription = (
  model: Pick<TaskApprovalCompletionModalModel, "publishTarget">,
): string =>
  model.publishTarget
    ? "Finish later to keep the task in Human Review while the local merge stays ready to publish."
    : "Finish later to keep the task in Human Review until you are ready to close it and clean up the builder workspace.";
