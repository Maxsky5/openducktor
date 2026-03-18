import type { RunSummary, TaskCard } from "@openducktor/contracts";

export type TaskDetailsSheetProps = {
  task: TaskCard | null;
  allTasks: TaskCard[];
  runs: RunSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowActionsEnabled?: boolean;
  onPlan?: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart?: (taskId: string) => void;
  onQaOpen?: (taskId: string) => void;
  onBuild?: (taskId: string) => void;
  onDelegate?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
  onDefer?: (taskId: string) => void;
  onResumeDeferred?: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
  onResetImplementation?: (taskId: string, options?: { closeDetailsAfterReset?: boolean }) => void;
  onDetectPullRequest?: (taskId: string) => void;
  onUnlinkPullRequest?: (taskId: string) => void;
  detectingPullRequestTaskId?: string | null;
  unlinkingPullRequestTaskId?: string | null;
  onDelete?: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};
