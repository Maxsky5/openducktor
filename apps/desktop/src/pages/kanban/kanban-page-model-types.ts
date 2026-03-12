import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario, KanbanColumn as KanbanColumnData } from "@openducktor/core";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { AgentSessionState } from "@/types/agent-orchestrator";

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

export type HumanReviewFeedbackTargetOption = {
  value: string;
  label: string;
  description: string;
  secondaryLabel?: string;
};

export type HumanReviewFeedbackModalModel = {
  open: boolean;
  taskId: string;
  selectedTarget: string;
  targetOptions: HumanReviewFeedbackTargetOption[];
  message: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onTargetChange: (value: string) => void;
  onMessageChange: (message: string) => void;
  onConfirm: () => void;
};

export type TaskApprovalMode = "direct_merge" | "pull_request";
export type PullRequestDraftMode = "manual" | "generate_ai";

export type TaskApprovalModalModel = {
  open: boolean;
  stage: "approval" | "push_target";
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
  targetBranch: string;
  publishTarget: string | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: TaskApprovalMode) => void;
  onMergeMethodChange: (mergeMethod: "merge_commit" | "squash" | "rebase") => void;
  onPullRequestDraftModeChange: (mode: PullRequestDraftMode) => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onConfirm: () => void;
  onSkipPush: () => void;
  onConfirmPush: () => void;
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
  activeSessionsByTaskId: Map<string, AgentSessionState[]>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
};

export type KanbanPageTaskComposerModel = {
  open: boolean;
  task: TaskCard | null;
  tasks: TaskCard[];
  onOpenChange: (open: boolean) => void;
};

export type KanbanPageTaskDetailsControllerModel = {
  allTasks: TaskCard[];
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
  onDelete: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};

export type KanbanPageModels = {
  header: KanbanPageHeaderModel;
  content: KanbanPageContentModel;
  taskComposer: KanbanPageTaskComposerModel;
  taskDetailsController: KanbanPageTaskDetailsControllerModel;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  taskApprovalModal: TaskApprovalModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
};
