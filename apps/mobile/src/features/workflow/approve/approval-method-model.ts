import {
  getTaskApprovalSubmitState,
  TASK_APPROVAL_COPY as COPY,
  TASK_APPROVAL_MERGE_METHOD_OPTIONS,
  TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS,
  taskApprovalModeOptions,
  taskApprovalPullRequestUnavailableMessage,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import type { TaskApprovalApprovalModalModel } from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import type { TaskApprovalImpact } from "@openducktor/frontend-core/tasks/details/use-task-close-impact";

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
  isPreparing: boolean,
): string | null => {
  if (!submit.confirmDisabled || isPreparing || model.isSubmitting) return null;
  // A close needs only its reads, and a failed read shows with Retry.
  if (model.mode === "close_task") return null;
  if (model.approvalContextError) return COPY.approvalContextErrorNote;
  if (model.hasUncommittedChanges) return "Commit or discard the uncommitted changes to merge.";
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
 * The Direct Merge (merge commit, squash, rebase), Pull Request (write manually or generate with
 * AI), and Close Task choices of the approval step, with the desktop rules. `isPreparing` is true
 * while a read of the approval still runs.
 */
export const approvalChoices = (
  model: TaskApprovalApprovalModalModel,
  impact: TaskApprovalImpact,
  isPreparing: boolean,
): ApprovalChoices => {
  const submit = getTaskApprovalSubmitState(model, impact, isPreparing);
  const pullRequest = model.mode === "pull_request";
  const directMerge = model.mode === "direct_merge";
  return {
    modes: taskApprovalModeOptions(model),
    mergeMethods: directMerge ? TASK_APPROVAL_MERGE_METHOD_OPTIONS : null,
    draftModes:
      pullRequest && model.pullRequestAvailable ? TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS : null,
    showPullRequestFields:
      pullRequest && model.pullRequestAvailable && model.pullRequestDraftMode === "manual",
    showSquashMessage: directMerge && model.mergeMethod === "squash",
    pullRequestUnavailable:
      model.pullRequestSupported &&
      !model.pullRequestAvailable &&
      model.pullRequestUnavailableReason
        ? taskApprovalPullRequestUnavailableMessage(model.pullRequestUnavailableReason)
        : null,
    confirmLabel: submit.confirmLabel,
    confirmDisabled: submit.confirmDisabled,
    confirmBlockedReason: blockedReason(model, submit, isPreparing),
    squashMessageError: submit.showSquashCommitMessageValidationError,
  };
};
