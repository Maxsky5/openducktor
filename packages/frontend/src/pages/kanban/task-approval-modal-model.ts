import type { Dispatch } from "react";
import type {
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
  TaskApprovalMissingBuilderWorktreeModalModel,
  TaskApprovalModalModel,
} from "./kanban-page-model-types";
import type { TaskApprovalFlowAction, TaskApprovalFlowOpenState } from "./task-approval-flow-state";

type BuildTaskApprovalModalModelArgs = {
  completeDirectMerge: () => void;
  confirm: () => void;
  dispatch: Dispatch<TaskApprovalFlowAction>;
  reset: () => void;
  resetMissingBuilderWorktree: () => void;
  state: TaskApprovalFlowOpenState;
};

export const buildTaskApprovalModalModel = ({
  completeDirectMerge,
  confirm,
  dispatch,
  reset,
  resetMissingBuilderWorktree,
  state,
}: BuildTaskApprovalModalModelArgs): TaskApprovalModalModel => {
  const approvalContext = state.approvalContext;
  const githubProvider = approvalContext?.providers.find((entry) => entry.providerId === "github");
  const baseModal = {
    open: true,
    taskId: state.taskId,
    isSubmitting: state.phase === "submitting",
    errorMessage: state.errorMessage,
    onOpenChange: (open: boolean) => {
      if (!open) {
        reset();
      }
    },
  };

  if (state.stage === "missing_builder_worktree") {
    return {
      ...baseModal,
      stage: "missing_builder_worktree",
      onCompleteMissingBuilderWorktree: confirm,
      onResetMissingBuilderWorktree: resetMissingBuilderWorktree,
    } satisfies TaskApprovalMissingBuilderWorktreeModalModel;
  }

  if (state.stage === "complete_direct_merge") {
    return {
      ...baseModal,
      stage: "complete_direct_merge",
      targetBranch: approvalContext?.targetBranch ?? null,
      publishTarget: approvalContext?.publishTarget ?? null,
      onSkipDirectMergeCompletion: reset,
      onCompleteDirectMerge: completeDirectMerge,
    } satisfies TaskApprovalCompletionModalModel;
  }

  return {
    ...baseModal,
    stage: "approval",
    isLoading: state.phase === "loading",
    mode: state.mode,
    mergeMethod: state.mergeMethod,
    pullRequestDraftMode: state.pullRequestDraftMode,
    pullRequestAvailable: githubProvider?.available ?? false,
    pullRequestUnavailableReason: githubProvider?.reason ?? null,
    hasUncommittedChanges: approvalContext?.hasUncommittedChanges ?? false,
    uncommittedFileCount: approvalContext?.uncommittedFileCount ?? 0,
    pullRequestUrl: approvalContext?.pullRequest?.url ?? null,
    title: state.title,
    body: state.body,
    squashCommitMessage: state.squashCommitMessage,
    squashCommitMessageTouched: state.squashCommitMessageTouched,
    hasSuggestedSquashCommitMessage: approvalContext?.suggestedSquashCommitMessage != null,
    targetBranch: approvalContext?.targetBranch ?? null,
    onModeChange: (mode) => dispatch({ type: "set_mode", mode }),
    onMergeMethodChange: (mergeMethod) => dispatch({ type: "set_merge_method", mergeMethod }),
    onPullRequestDraftModeChange: (pullRequestDraftMode) =>
      dispatch({ type: "set_pull_request_draft_mode", pullRequestDraftMode }),
    onTitleChange: (title) => dispatch({ type: "set_title", title }),
    onBodyChange: (body) => dispatch({ type: "set_body", body }),
    onSquashCommitMessageChange: (squashCommitMessage) =>
      dispatch({ type: "set_squash_commit_message", squashCommitMessage }),
    onConfirm: confirm,
  } satisfies TaskApprovalApprovalModalModel;
};
