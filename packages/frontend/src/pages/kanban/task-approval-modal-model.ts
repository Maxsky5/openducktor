import type { Dispatch } from "react";
import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { errorMessage } from "@/lib/errors";
import type {
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
  TaskApprovalMissingBuilderWorktreeModalModel,
  TaskApprovalModalModel,
} from "./kanban-page-model-types";
import type { TaskApprovalFlowAction, TaskApprovalFlowOpenState } from "./task-approval-flow-state";
import { resolveCurrentTaskApprovalMode } from "./task-approval-transition-resolver";

type BuildTaskApprovalModalModelArgs = {
  completeDirectMerge: () => void;
  confirm: () => void;
  dispatch: Dispatch<TaskApprovalFlowAction>;
  reset: () => void;
  resetMissingBuilderWorktree: () => void;
  state: TaskApprovalFlowOpenState;
  gitProviderContext: RepositoryGitProviderContext | undefined;
  gitProviderContextError: Error | null;
};

export const buildTaskApprovalModalModel = ({
  completeDirectMerge,
  confirm,
  dispatch,
  reset,
  resetMissingBuilderWorktree,
  state,
  gitProviderContext,
  gitProviderContextError,
}: BuildTaskApprovalModalModelArgs): TaskApprovalModalModel => {
  const approvalContext = state.approvalContext;
  const mode = resolveCurrentTaskApprovalMode(state.mode, gitProviderContext);
  const providerReadError = gitProviderContextError
    ? `Could not load the current Git provider: ${errorMessage(gitProviderContextError)}`
    : null;
  let pullRequestSupported = false;
  let pullRequestAvailable = false;
  let pullRequestUnavailableReason: string | null = null;
  if (gitProviderContext?.descriptor.capabilities.supportsPullRequests === true) {
    pullRequestSupported = true;
    pullRequestAvailable =
      providerReadError === null &&
      gitProviderContext.config.enabled &&
      gitProviderContext.health.available;
    if (!pullRequestAvailable) {
      pullRequestUnavailableReason =
        providerReadError ??
        gitProviderContext.health.reason ??
        `${gitProviderContext.descriptor.label} is not available for Pull Requests.`;
    }
  }
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
    mode,
    mergeMethod: state.mergeMethod,
    pullRequestDraftMode: state.pullRequestDraftMode,
    pullRequestSupported,
    pullRequestAvailable,
    pullRequestUnavailableReason,
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
