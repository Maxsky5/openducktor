import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { createContext, useContext } from "react";
import type {
  ActiveTaskSessionContext,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type { SessionTargetOptions } from "@/components/features/kanban/session-target-resolution";

export type TaskWorkflowActions = {
  onCreateTask: () => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onDelegate: (taskId: string) => void;
  onEdit: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onResetImplementation: (taskId: string, options?: { closeDetailsAfterReset?: boolean }) => void;
  onResetTask: (taskId: string) => Promise<void>;
  onCloseTask: (taskId: string) => Promise<void>;
  onDelete: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
  onDetectPullRequest: (taskId: string) => void;
  onUnlinkPullRequest: (taskId: string) => void;
  detectingPullRequestTaskId: string | null;
  unlinkingPullRequestTaskId: string | null;
  gitProviderContext: RepositoryGitProviderContext | undefined;
  gitProviderReadError: string | null;
  registerTaskDetailsClose: (close: () => void) => () => void;
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  activeTaskSessionContextByTaskId: Map<string, ActiveTaskSessionContext>;
};

export const TaskWorkflowActionsContext = createContext<TaskWorkflowActions | null>(null);

export const useTaskWorkflowActions = (): TaskWorkflowActions | null =>
  useContext(TaskWorkflowActionsContext);

export const useRequiredTaskWorkflowActions = (): TaskWorkflowActions => {
  const actions = useTaskWorkflowActions();
  if (actions === null) {
    throw new Error("Task workflow actions require TaskWorkflowActionsProvider");
  }
  return actions;
};
