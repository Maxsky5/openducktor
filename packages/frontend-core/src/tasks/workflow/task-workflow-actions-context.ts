import type { LaunchTaskWorkflow } from "./task-workflow-continuation";
import type { RunTaskAction } from "./task-action-runner";
import type { RepositoryGitProviderContext, TaskCard } from "@openducktor/contracts";
import { createContext, useContext } from "react";
import type { ActiveTaskSessionContext, KanbanTaskSession } from "../board/kanban-task-activity";
import type { WorkflowPendingState } from "../board/kanban-task-footer";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import type { EditTaskSection } from "../create/task-composer-types";
import type { TaskConfirmRequestAction } from "./task-confirm-actions";
import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";
import type { CloseTaskOptions } from "../../types/task-close";
import type { WorkflowDialogOwnership } from "./use-workflow-dialog-owner";

export type TaskWorkflowActions = {
  /** Runs a declared workflow action of any surface. A failure shows its message. */
  runAction: RunTaskAction;
  onLaunch: LaunchTaskWorkflow;
  kanbanPendingState?: WorkflowPendingState;
  /** Open New task for the active workspace. The title starts with `initialTitle`. */
  onCreateTask: (options?: { initialTitle?: string }) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onEdit: (taskId: string, section?: EditTaskSection) => void;
  /** Open the details sheet of a task of the active workspace, on any page. */
  onOpenTaskDetails: (taskId: string) => void;
  onResetTask: (taskId: string) => Promise<TaskCard>;
  onCloseTask: (taskId: string, options: CloseTaskOptions) => Promise<TaskCard>;
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
  /** Read `useWorkflowDialogOwner` for the rule that each action must follow. */
  claimWorkflowDialog: WorkflowDialogOwnership["claimWorkflowDialog"];
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>;
  activeTaskSessionContextByTaskId: Map<string, ActiveTaskSessionContext>;
};

export const TaskWorkflowActionsContext = createContext<TaskWorkflowActions | null>(null);

/**
 * The owner of the open shared dialog, such as Request Changes or Edit task. It has its own
 * context, so a change of owner does not render every consumer of the workflow actions.
 */
export const TaskWorkflowDialogOwnerContext =
  createContext<WorkflowDialogOwnership["workflowDialogOwner"]>(null);

export const useTaskWorkflowActions = (): TaskWorkflowActions | null =>
  useContext(TaskWorkflowActionsContext);

export const useRequiredTaskWorkflowActions = (): TaskWorkflowActions => {
  const actions = useTaskWorkflowActions();
  if (actions === null) {
    throw new Error("Task workflow actions require TaskWorkflowActionsProvider");
  }
  return actions;
};
