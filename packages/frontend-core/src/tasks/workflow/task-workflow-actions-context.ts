import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { createContext, useContext } from "react";
import type { ActiveTaskSessionContext, KanbanTaskSession } from "../board/kanban-task-activity";
import type { WorkflowPendingState } from "../board/kanban-task-footer";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import type { EditTaskSection } from "../create/task-composer-types";
import type { TaskConfirmRequestAction } from "./task-confirm-actions";
import type { BuiltinRoleId as AgentRole } from "@openducktor/workflows";
import type { CloseTaskOptions } from "../../types/task-close";

export type TaskWorkflowActions = {
  kanbanPendingState?: WorkflowPendingState;
  /** Open New task for the active workspace. The title starts with `initialTitle`. */
  onCreateTask: (options?: { initialTitle?: string }) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onDelegate: (taskId: string) => void;
  onEdit: (taskId: string, section?: EditTaskSection) => void;
  /** Open the details sheet of a task of the active workspace, on any page. */
  onOpenTaskDetails: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onResetImplementation: (taskId: string, options?: { closeDetailsAfterReset?: boolean }) => void;
  onResetTask: (taskId: string) => Promise<void>;
  onCloseTask: (taskId: string, options: CloseTaskOptions) => Promise<void>;
  /** Removes the worktree and local branches of a closed task. */
  onRemoveTaskWorktree: (taskId: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  /** Open the confirmation of `action` for a task of the active workspace, on any page. */
  onConfirmTaskAction: (taskId: string, action: TaskConfirmRequestAction) => void;
  onDetectPullRequest: (taskId: string) => void;
  onUnlinkPullRequest: (taskId: string) => void;
  detectingPullRequestTaskIds: ReadonlySet<string>;
  unlinkingPullRequestTaskIds: ReadonlySet<string>;
  gitProviderContext: RepositoryGitProviderContext | undefined;
  gitProviderReadError: string | null;
  registerTaskDetailsClose: (taskId: string, close: () => void) => () => void;
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
