import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import type { KanbanTaskSession } from "@/components/features/kanban/kanban-task-activity";

export type TaskDetailsSheetProps = {
  activeRepo?: string | null;
  task: TaskCard | null;
  allTasks: TaskCard[];
  runs: RunSummary[];
  taskSessions?: KanbanTaskSession[];
  hasActiveSession?: boolean;
  activeSessionRole?: AgentRole;
  activeSessionPresentationState?: KanbanTaskSession["presentationState"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowActionsEnabled?: boolean;
  onPlan?: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart?: (taskId: string) => void;
  onQaOpen?: (taskId: string) => void;
  onBuild?: (taskId: string) => void;
  onOpenSession?: (
    taskId: string,
    role: AgentRole,
    options?: { sessionId?: string | null; scenario?: AgentScenario | null },
  ) => void;
  onDelegate?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
  onDefer?: (taskId: string) => void;
  onResumeDeferred?: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
  onResetImplementation?: (taskId: string, options?: { closeDetailsAfterReset?: boolean }) => void;
  onResetTask?: (taskId: string) => Promise<void>;
  onDetectPullRequest?: (taskId: string) => void;
  onUnlinkPullRequest?: (taskId: string) => void;
  detectingPullRequestTaskId?: string | null;
  unlinkingPullRequestTaskId?: string | null;
  onDelete?: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};
