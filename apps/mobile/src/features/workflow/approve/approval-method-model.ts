import {
  getTaskApprovalSubmitState,
  TASK_APPROVAL_MERGE_METHOD_OPTIONS,
  TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS,
  taskApprovalModeOptions,
  taskApprovalPullRequestUnavailableMessage,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import type { TaskApprovalApprovalModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";

/** The choices of the approval step, with the reasons that block them. */
export type ApprovalChoices = {
  modes: Array<{ value: TaskApprovalApprovalModalModel["mode"]; label: string; disabled: boolean }>;
  /** Shown while Direct Merge is the mode. */
  mergeMethods: typeof TASK_APPROVAL_MERGE_METHOD_OPTIONS | null;
  /** Shown while Pull Request is the mode and the provider can create one. */
  draftModes: typeof TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS | null;
  /** True while a manual pull request needs its title and description. */
  showPullRequestFields: boolean;
  /** True while a squash merge needs its commit message. */
  showSquashMessage: boolean;
  pullRequestUnavailable: string | null;
  confirmLabel: string;
  confirmDisabled: boolean;
  /** Why the confirm control is disabled, or null while it is enabled, loading, or submitting. */
  confirmBlockedReason: string | null;
  squashMessageError: boolean;
};

const blockedReason = (
  model: TaskApprovalApprovalModalModel,
  submit: ReturnType<typeof getTaskApprovalSubmitState>,
): string | null => {
  if (!submit.confirmDisabled || model.isLoading || model.isSubmitting) return null;
  if (model.hasUncommittedChanges) return "Commit or discard the uncommitted changes to approve.";
  if (model.mode === "pull_request" && !model.pullRequestAvailable) {
    return "Pull Request is not available now. Use Direct Merge, or try again later.";
  }
  if (submit.hasManualPullRequestValidationError) {
    return "Write the pull request title and description.";
  }
  if (submit.hasSquashCommitMessageSubmitError) return "Write the squash commit message.";
  return null;
};

/**
 * The Direct Merge (merge commit, squash, rebase) and Pull Request (write manually or generate
 * with AI) choices of the approval step, with the desktop rules.
 */
export const approvalChoices = (model: TaskApprovalApprovalModalModel): ApprovalChoices => {
  const submit = getTaskApprovalSubmitState(model);
  const pullRequest = model.mode === "pull_request";
  return {
    modes: taskApprovalModeOptions(model),
    mergeMethods: pullRequest ? null : TASK_APPROVAL_MERGE_METHOD_OPTIONS,
    draftModes:
      pullRequest && model.pullRequestAvailable ? TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS : null,
    showPullRequestFields:
      pullRequest && model.pullRequestAvailable && model.pullRequestDraftMode === "manual",
    showSquashMessage: !pullRequest && model.mergeMethod === "squash",
    pullRequestUnavailable:
      model.pullRequestSupported &&
      !model.pullRequestAvailable &&
      model.pullRequestUnavailableReason
        ? taskApprovalPullRequestUnavailableMessage(model.pullRequestUnavailableReason)
        : null,
    confirmLabel: submit.confirmLabel,
    confirmDisabled: submit.confirmDisabled,
    confirmBlockedReason: blockedReason(model, submit),
    squashMessageError: submit.showSquashCommitMessageValidationError,
  };
};
