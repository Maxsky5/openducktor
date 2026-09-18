import type {
  AgentSessionRecord,
  GitTargetBranch,
  KanbanEmptyColumnDisplay,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentRole, KanbanColumn as KanbanColumnData } from "@openducktor/core";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type { SessionTargetOptions } from "@/components/features/kanban/session-target-resolution";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import type { SessionStartFlowRequest } from "@/features/session-start";
import type { ActiveWorkspace } from "@/types/state-slices";

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
  onSkipDirectMergeCompletion: () => void;
  onCompleteDirectMerge: () => void;
};

export type TaskApprovalModalModel =
  | TaskApprovalApprovalModalModel
  | TaskApprovalMissingBuilderWorktreeModalModel
  | TaskApprovalCompletionModalModel;

export type KanbanPageHeaderModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  onCreateTask: () => void;
  onRefreshTasks: () => void;
};

export type KanbanPageContentModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  emptyColumnDisplay: KanbanEmptyColumnDisplay;
  showHorizontalScrollbars: boolean | null;
  columns: KanbanColumnData[];
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  historicalSessionsByTaskId: Map<string, AgentSessionRecord[]>;
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onResetImplementation: (taskId: string) => void;
};

export type KanbanPageTaskDetailsControllerModel = {
  activeWorkspace: ActiveWorkspace | null;
  allTasks: TaskCard[];
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
  taskDetailsController: KanbanPageTaskDetailsControllerModel;
  mergedPullRequestModal: {
    pullRequest: NonNullable<TaskCard["pullRequest"]>;
    isLinking: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  } | null;
};
