import type { GitTargetBranch, RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario, KanbanColumn as KanbanColumnData } from "@openducktor/core";
import type { SessionStartModalModel } from "@/components/features/agents";
import type {
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import type {
  GitConflictResolutionDecision,
  PendingGitConflictResolutionRequest,
} from "@/features/git-conflict-resolution";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";

export type KanbanSessionStartIntent = {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  startMode: "fresh" | "reuse_latest";
  postStartAction: "none" | "kickoff" | "send_message";
  message?: string;
  beforeStartAction?: {
    action: "human_request_changes";
    note: string;
  };
};

export type TaskApprovalMode = "direct_merge" | "pull_request";
export type PullRequestDraftMode = "manual" | "generate_ai";

export type TaskApprovalModalModel = {
  open: boolean;
  stage: "approval" | "complete_direct_merge";
  taskId: string;
  isLoading: boolean;
  mode: TaskApprovalMode;
  mergeMethod: "merge_commit" | "squash" | "rebase";
  pullRequestDraftMode: PullRequestDraftMode;
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
  publishTarget: GitTargetBranch | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: TaskApprovalMode) => void;
  onMergeMethodChange: (mergeMethod: "merge_commit" | "squash" | "rebase") => void;
  onPullRequestDraftModeChange: (mode: PullRequestDraftMode) => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSquashCommitMessageChange: (value: string) => void;
  onConfirm: () => void;
  onSkipDirectMergeCompletion: () => void;
  onCompleteDirectMerge: () => void;
};

export type KanbanPageHeaderModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  onCreateTask: () => void;
  onRefreshTasks: () => void;
};

export type KanbanPageContentModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  columns: KanbanColumnData[];
  runStateByTaskId: Map<string, RunSummary["state"]>;
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onResetImplementation: (taskId: string) => void;
};

export type KanbanPageTaskComposerModel = {
  open: boolean;
  task: TaskCard | null;
  tasks: TaskCard[];
  onOpenChange: (open: boolean) => void;
};

export type KanbanPageTaskDetailsControllerModel = {
  allTasks: TaskCard[];
  runs: RunSummary[];
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onEdit: (taskId: string) => void;
  onDefer: (taskId: string) => void;
  onResumeDeferred: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onResetImplementation: (taskId: string, options?: { closeDetailsAfterReset?: boolean }) => void;
  onDetectPullRequest: (taskId: string) => void;
  onUnlinkPullRequest: (taskId: string) => void;
  detectingPullRequestTaskId: string | null;
  unlinkingPullRequestTaskId: string | null;
  onDelete: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};

export type KanbanPageModels = {
  header: KanbanPageHeaderModel;
  content: KanbanPageContentModel;
  taskComposer: KanbanPageTaskComposerModel;
  taskDetailsController: KanbanPageTaskDetailsControllerModel;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  taskApprovalModal: TaskApprovalModalModel | null;
  resetImplementationModal: {
    open: boolean;
    taskId: string;
    taskTitle: string;
    targetStatusLabel: string;
    isSubmitting: boolean;
    isLoadingImpact: boolean;
    hasManagedSessionCleanup: boolean;
    managedWorktreeCount: number;
    impactError: string | null;
    errorMessage: string | null;
    onOpenChange: (open: boolean) => void;
    onCancel: () => void;
    onConfirm: () => void;
  } | null;
  taskGitConflictDialog: {
    open: boolean;
    conflict: GitConflict | null;
    isHandlingConflict: boolean;
    conflictAction: GitConflictAction;
    onOpenChange: (open: boolean) => void;
    onAbort: () => void;
    onAskBuilder: () => void;
  } | null;
  gitConflictResolutionModal: {
    request: PendingGitConflictResolutionRequest;
    onResolve: (decision: GitConflictResolutionDecision) => void;
  } | null;
  sessionStartModal: SessionStartModalModel | null;
};
