import type { GitPublicationPreview, GitTargetBranch } from "@openducktor/contracts";
import type { GitConflict, GitConflictAction } from "../../git/contracts";

export type TaskApprovalMode = "direct_merge" | "pull_request";
export type PullRequestDraftMode = "manual" | "generate_ai";
export type TaskApprovalOpenOptions = {
  mode?: TaskApprovalMode;
  pullRequestDraftMode?: PullRequestDraftMode;
  errorMessage?: string | null;
};

type TaskApprovalModalBase = {
  open: boolean;
  taskId: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  /** True when the connection lost the result of the last submit. The host may have run it. */
  errorOutcomeUnknown: boolean;
  onOpenChange: (open: boolean) => void;
};

export type TaskApprovalApprovalModalModel = TaskApprovalModalBase & {
  stage: "approval";
  isLoading: boolean;
  mode: TaskApprovalMode;
  mergeMethod: "merge_commit" | "squash" | "rebase";
  pullRequestDraftMode: PullRequestDraftMode;
  pullRequestSupported: boolean;
  pullRequestAvailable: boolean;
  pullRequestUnavailableReason: string | null;
  hasUncommittedChanges: boolean;
  uncommittedFileCount: number;
  pullRequestUrl: string | null;
  title: string;
  body: string;
  squashCommitMessage: string;
  squashCommitMessageTouched: boolean;
  hasSuggestedSquashCommitMessage: boolean;
  targetBranch: GitTargetBranch | null;
  onModeChange: (mode: TaskApprovalMode) => void;
  onMergeMethodChange: (mergeMethod: "merge_commit" | "squash" | "rebase") => void;
  onPullRequestDraftModeChange: (mode: PullRequestDraftMode) => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSquashCommitMessageChange: (value: string) => void;
  onConfirm: () => void;
};

export type TaskApprovalMissingBuilderWorktreeModalModel = TaskApprovalModalBase & {
  stage: "missing_builder_worktree";
  onCompleteMissingBuilderWorktree: () => void;
  onResetMissingBuilderWorktree: () => void;
};

export type TaskApprovalCompletionModalModel = TaskApprovalModalBase & {
  stage: "complete_direct_merge";
  targetBranch: GitTargetBranch | null;
  publishTarget: GitTargetBranch | null;
  publicationPreview: GitPublicationPreview | null;
  onSkipDirectMergeCompletion: () => void;
  onCompleteDirectMerge: () => void;
};

export type TaskApprovalModalModel =
  | TaskApprovalApprovalModalModel
  | TaskApprovalMissingBuilderWorktreeModalModel
  | TaskApprovalCompletionModalModel;

export type TaskGitConflictDialogModel = {
  open: boolean;
  conflict: GitConflict | null;
  isHandlingConflict: boolean;
  conflictAction: GitConflictAction;
  onOpenChange: (open: boolean) => void;
  onAbort: () => void;
  onAskBuilder: () => void;
};
