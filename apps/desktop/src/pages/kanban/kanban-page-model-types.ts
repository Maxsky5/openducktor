import type { GitTargetBranch, RunSummary, TaskCard } from "@openducktor/contracts";
import type {
  AgentRole,
  AgentScenario,
  AgentSessionStartMode,
  KanbanColumn as KanbanColumnData,
} from "@openducktor/core";
import type { SessionStartModalModel } from "@/components/features/agents";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type { GitConflict, GitConflictAction } from "@/features/agent-studio-git";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";

export type KanbanSessionStartIntent = {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  initialStartMode?: AgentSessionStartMode;
  targetWorkingDirectory?: string | null;
  sourceSessionId?: string | null;
  existingSessionOptions?: Array<{
    value: string;
    label: string;
    description: string;
    secondaryLabel?: string;
  }>;
  postStartAction: "none" | "kickoff" | "send_message";
  message?: string;
  beforeStartAction?: {
    action: "human_request_changes";
    note: string;
  };
};

export type KanbanResolvedSessionStartIntent = KanbanSessionStartIntent & {
  startMode: AgentSessionStartMode;
};

export type TaskApprovalMode = "direct_merge" | "pull_request";
export type PullRequestDraftMode = "manual" | "generate_ai";

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
  columns: KanbanColumnData[];
  runStateByTaskId: Map<string, RunSummary["state"]>;
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onOpenSession: (
    taskId: string,
    role: AgentRole,
    options?: { sessionId?: string | null; scenario?: AgentScenario | null },
  ) => void;
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
  activeRepo: string | null;
  allTasks: TaskCard[];
  runs: RunSummary[];
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  activeTaskSessionContextByTaskId: ActiveTaskSessionContextByTaskId;
  onOpenSession: (
    taskId: string,
    role: AgentRole,
    options?: { sessionId?: string | null; scenario?: AgentScenario | null },
  ) => void;
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
  onResetTask: (taskId: string) => Promise<void>;
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
  mergedPullRequestModal: {
    pullRequest: NonNullable<TaskCard["pullRequest"]>;
    isLinking: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  } | null;
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
  sessionStartModal: SessionStartModalModel | null;
};
