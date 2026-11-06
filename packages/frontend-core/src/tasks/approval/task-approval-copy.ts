import type { GitTargetBranch } from "@openducktor/contracts";
import { canonicalTargetBranch } from "../../lib/target-branch";
import { taskCloseConfirmLabel } from "../details/task-close-copy";
import {
  isCloseBlocked,
  type TaskApprovalImpact,
  type TaskCloseImpact,
  type TaskWorktreeImpact,
} from "../details/use-task-close-impact";
import type {
  PullRequestDraftMode,
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
  TaskApprovalMissingWorktreeModalModel,
  TaskApprovalMode,
} from "./task-approval-types";

type TaskApprovalMergeMethod = TaskApprovalApprovalModalModel["mergeMethod"];

/** A sentence with a branch or path in it. Platforms show `code` in the code font. */
export type TaskApprovalTextWithCode = { before: string; code: string; after: string };

export const TASK_APPROVAL_MODE_OPTIONS: ReadonlyArray<{
  value: TaskApprovalMode;
  label: string;
}> = [
  { value: "direct_merge", label: "Direct merge" },
  { value: "pull_request", label: "Pull request" },
  { value: "close_task", label: "Close task" },
];

export const TASK_APPROVAL_MERGE_METHOD_OPTIONS: ReadonlyArray<{
  value: TaskApprovalMergeMethod;
  label: string;
  description: string;
}> = [
  {
    value: "merge_commit",
    label: "Merge commit",
    description: "Keep the branch history with a merge commit.",
  },
  {
    value: "squash",
    label: "Squash",
    description: "Combine the Builder branch changes into one commit.",
  },
  {
    value: "rebase",
    label: "Rebase",
    description: "Apply the Builder commits on top of the target branch.",
  },
];

/**
 * The pull request draft choices. The generated draft names the one pull request role of the
 * workflow, or an agent when the workflow names zero or several roles.
 */
export const taskApprovalPullRequestDraftOptions = (
  pullRequestRoleLabel: string | null,
): Array<{ value: PullRequestDraftMode; label: string; description: string }> => [
  {
    value: "manual",
    label: "Write manually",
    description: "Write the pull request title and description.",
  },
  {
    value: "generate_ai",
    label: `Ask ${pullRequestRoleLabel ?? "agent"}`,
    description: `Let ${pullRequestRoleLabel ?? "an agent"} create or update the pull request.`,
  },
];

/** The notice of the generated draft: the next step chooses the session that creates it. */
export const taskApprovalGeneratePullRequestNotice = (
  pullRequestRoleLabel: string | null,
): string =>
  `Next, choose the ${pullRequestRoleLabel ? `${pullRequestRoleLabel} ` : ""}session to use.`;

/** The fixed text of the approval flow. */
export const TASK_APPROVAL_COPY = {
  uncommittedChangesTitle: "Uncommitted changes",
  approvalFailedTitle: "Approval failed",
  approvalContextErrorTitle: "Merge and pull request options are unavailable",
  approvalContextErrorNote: "You can still close the task without merging code.",
  approvalActionLabel: "Approval action",
  approvalActionAccessibilityLabel: "Approval action",
  mergeMethodLabel: "Merge method",
  squashCommitMessageLabel: "Squash commit message",
  squashCommitMessagePlaceholder: "e.g. feat: add Microsoft login",
  squashCommitMessageRequired: "Enter the squash commit message before merging locally.",
  pullRequestDraftLabel: "Pull request draft",
  pullRequestTitleLabel: "Pull request title",
  pullRequestDescriptionLabel: "Pull request description",
  openExistingPullRequest: "Open existing pull request",
  cancel: "Cancel",
  recoveryFailedTitle: "Could not finish this action",
  completionFailedTitle: "Could not finish the merge",
  localMergeReadyTitle: "Local merge ready",
  nextStepTitle: "Next step",
  localBranchLabel: "Local branch",
  remoteToUpdateLabel: "Push to",
  finishLater: "Finish later",
} as const;

/** The approval modes that the provider supports. A mode that cannot run now is disabled. */
export const taskApprovalModeOptions = (
  model: Pick<
    TaskApprovalApprovalModalModel,
    "pullRequestSupported" | "pullRequestAvailable" | "approvalContextError"
  >,
): Array<{ value: TaskApprovalMode; label: string; disabled: boolean }> =>
  TASK_APPROVAL_MODE_OPTIONS.filter(
    (option) => option.value !== "pull_request" || model.pullRequestSupported,
  ).map((option) => ({
    value: option.value,
    label: option.label,
    // Direct Merge and Pull Request need the approval context. Close Task does not.
    disabled:
      (option.value !== "close_task" && model.approvalContextError !== null) ||
      (option.value === "pull_request" && !model.pullRequestAvailable),
  }));

export const taskApprovalPullRequestUnavailableMessage = (reason: string): string =>
  `Pull request unavailable: ${reason}`;

export const taskApprovalUncommittedChangesMessage = (uncommittedFileCount: number): string =>
  uncommittedFileCount === 1
    ? "The builder worktree has 1 uncommitted file. Commit or discard it before you merge."
    : `The builder worktree has ${uncommittedFileCount} uncommitted files. Commit or discard them before you merge.`;

export const taskApprovalSquashCommitHint = (
  targetBranch: GitTargetBranch | null,
): TaskApprovalTextWithCode => ({
  before: "Edit this message before combining the branch changes into one commit on ",
  code: targetBranch?.branch ?? "the target branch",
  after: ".",
});

/**
 * Why the approval cannot submit now, and the label of its confirm control. `isPreparing` is true
 * while a read of the approval still runs.
 */
export const getTaskApprovalSubmitState = (
  model: TaskApprovalApprovalModalModel,
  impact: TaskApprovalImpact,
  isPreparing: boolean,
) => {
  if (model.mode === "close_task") {
    return {
      hasManualPullRequestValidationError: false,
      hasSquashCommitMessageSubmitError: false,
      showSquashCommitMessageValidationError: false,
      // Uncommitted changes do not block a close. Its confirmation shows them.
      confirmDisabled:
        isPreparing || model.isSubmitting || isCloseBlocked(impact.close, model.removeWorktree),
      confirmLabel: taskCloseConfirmLabel(model.isSubmitting),
    };
  }
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

  let confirmLabel = "Merge locally";
  if (model.mode === "pull_request" && model.pullRequestDraftMode === "manual") {
    confirmLabel = "Create pull request";
  } else if (model.mode === "pull_request") {
    confirmLabel = `Choose ${model.pullRequestRoleLabel ? `${model.pullRequestRoleLabel} ` : ""}session`;
  }

  return {
    hasManualPullRequestValidationError,
    hasSquashCommitMessageSubmitError,
    showSquashCommitMessageValidationError,
    confirmDisabled:
      isPreparing ||
      model.isSubmitting ||
      model.hasUncommittedChanges ||
      model.approvalContextError !== null ||
      // A direct merge closes the task. A pull request does not, so it needs no cleanup impact.
      (model.mode === "direct_merge" && isCloseBlocked(impact.worktree, model.removeWorktree)) ||
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

/** Whether Close Task of the missing worktree stage cannot run now. */
export const missingWorktreeConfirmDisabled = (
  model: Pick<TaskApprovalMissingWorktreeModalModel, "isSubmitting" | "removeWorktree">,
  impact: TaskCloseImpact,
  isPreparing: boolean,
): boolean => isPreparing || model.isSubmitting || isCloseBlocked(impact, model.removeWorktree);

/** Whether the completion of a recorded direct merge cannot run now. */
export const directMergeCompletionConfirmDisabled = (
  model: TaskApprovalCompletionModalModel,
  impact: TaskWorktreeImpact,
  isPreparing: boolean,
): boolean =>
  isPreparing ||
  model.isSubmitting ||
  getDirectMergeCompletionContextError(model) !== null ||
  isCloseBlocked(impact, model.removeWorktree);

/** Why the direct merge cannot complete from this context, or null when it can. */
export const getDirectMergeCompletionContextError = (
  model: Pick<
    TaskApprovalCompletionModalModel,
    "targetBranch" | "publishTarget" | "publicationPreview"
  >,
): string | null => {
  if (model.targetBranch === null)
    return "Close and reopen Approve task to load the target branch.";
  return model.publishTarget && !model.publicationPreview
    ? "Close and reopen Approve task to load the push details."
    : null;
};

export const taskApprovalLocalMergeReadyText = (
  localBranchName: string,
): TaskApprovalTextWithCode => ({
  before: "The code is already merged into ",
  code: localBranchName,
  after: " on this computer.",
});

export const taskApprovalCompletionNextStepText = (
  model: Pick<TaskApprovalCompletionModalModel, "targetBranch" | "publishTarget">,
): TaskApprovalTextWithCode =>
  model.publishTarget
    ? {
        before: "Push ",
        code: canonicalTargetBranch(model.publishTarget),
        after: " to publish the merged target branch, then move the task to Done.",
      }
    : {
        before: "Move the task to Done. The merge is already applied locally on ",
        code: model.targetBranch?.branch ?? "",
        after: ".",
      };

export const taskApprovalPublicationCommitLabel = (sourceOid: string): string =>
  `Commit ${sourceOid.slice(0, 12)}`;

export const directMergeCompletionButtonLabel = (
  model: Pick<TaskApprovalCompletionModalModel, "isSubmitting" | "publishTarget">,
): string => {
  const publishTargetBranchName = model.publishTarget?.branch ?? "";
  if (model.isSubmitting && model.publishTarget) return `Pushing ${publishTargetBranchName}…`;
  if (model.isSubmitting) return "Completing merge…";
  if (model.publishTarget) return `Push ${publishTargetBranchName} and mark done`;
  return "Mark task done";
};

export const directMergeCompletionStageDescription = (
  model: Pick<TaskApprovalCompletionModalModel, "publishTarget">,
): string =>
  model.publishTarget
    ? "Finish later to keep the task in Human Review while the local merge stays ready to publish."
    : "Finish later to keep the task in Human Review until you are ready to close it.";
