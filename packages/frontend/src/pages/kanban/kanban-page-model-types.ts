import type {
  AgentSessionRecord,
  GitTargetBranch,
  KanbanEmptyColumnDisplay,
  KanbanTaskCardView,
} from "@openducktor/contracts";
import type { AgentRole, KanbanColumn as KanbanColumnData } from "@openducktor/core";
import type { ComponentProps } from "react";
import type { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type { WorkflowPendingState } from "@/components/features/kanban/kanban-task-footer";
import type { SessionTargetOptions } from "@/components/features/kanban/session-target-resolution";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import type { SessionStartFlowRequest } from "@/features/session-start";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { KanbanBoardFilter } from "./kanban-board-filter";

export type KanbanSessionStartIntent = SessionStartFlowRequest;

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
  publicationPreview: import("@openducktor/contracts").GitPublicationPreview | null;
  onSkipDirectMergeCompletion: () => void;
  onCompleteDirectMerge: () => void;
};

export type TaskApprovalModalModel =
  | TaskApprovalApprovalModalModel
  | TaskApprovalMissingBuilderWorktreeModalModel
  | TaskApprovalCompletionModalModel;

export type KanbanBoardFilterModel = {
  value: KanbanBoardFilter;
  /** The labels of the loaded tasks and the selected labels, in alphabetical order. */
  labelOptions: readonly string[];
  isActive: boolean;
  isDisabled: boolean;
  onChange: (patch: Partial<KanbanBoardFilter>) => void;
  onClear: () => void;
};

export type KanbanPageHeaderModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  taskCardView: KanbanTaskCardView | null;
  isTaskCardViewPending: boolean;
  onTaskCardViewChange: (taskCardView: KanbanTaskCardView) => void;
  onRefreshTasks: () => void;
  filter: KanbanBoardFilterModel;
};

export type KanbanPageContentModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  emptyColumnDisplay: KanbanEmptyColumnDisplay;
  taskCardView: KanbanTaskCardView;
  pendingState?: WorkflowPendingState | undefined;
  showHorizontalScrollbars: boolean | null;
  columns: KanbanColumnData[];
  /** The board loaded at least one task, also when the search and filters hide it. */
  hasLoadedTasks: boolean;
  filter: Pick<KanbanBoardFilterModel, "isActive" | "onClear">;
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  historicalSessionsByTaskId: Map<string, AgentSessionRecord[]>;
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onResetImplementation: (taskId: string) => void;
};

export type TaskResetImplementationModalModel = {
  open: boolean;
  taskId: string;
  taskTitle: string;
  targetStatusLabel: string;
  isSubmitting: boolean;
  activeSessionCount: number | null;
  activeSessionCountError: string | null;
  isLoadingImpact: boolean;
  hasCanonicalWorktree: boolean;
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  legacyWorktreeCount: number;
  terminalCount: number;
  impactError: string | null;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export type TaskGitConflictDialogModel = {
  open: boolean;
  conflict: GitConflict | null;
  isHandlingConflict: boolean;
  conflictAction: GitConflictAction;
  onOpenChange: (open: boolean) => void;
  onAbort: () => void;
  onAskBuilder: () => void;
};

export type KanbanPageModels = {
  header: KanbanPageHeaderModel;
  content: KanbanPageContentModel;
  activeWorkspace: ActiveWorkspace | null;
  mergedPullRequestModal: ComponentProps<typeof MergedPullRequestConfirmDialog> | null;
};
