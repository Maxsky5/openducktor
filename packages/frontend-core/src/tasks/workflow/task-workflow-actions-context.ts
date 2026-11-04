import type { LaunchTaskWorkflow, TaskWorkflowContinuation } from "./task-workflow-continuation";
import type { RepositoryGitProviderContext, TaskCard } from "@openducktor/contracts";
import { createContext, useContext } from "react";
import type { ActiveTaskSessionContext, KanbanTaskSession } from "../board/kanban-task-activity";
import type { WorkflowPendingState } from "../board/kanban-task-footer";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import type { EditTaskSection } from "../create/task-composer-types";
import type { TaskConfirmRequestAction } from "./task-confirm-actions";
import type {
  WorkflowRoleId as AgentRole,
  ResolvedTaskCard,
  TaskWorkflowAction,
} from "@openducktor/workflows";
import type { SessionOptionsOf } from "./task-action-destination";
import type { CloseTaskOptions } from "../../types/task-close";
import type { WorkflowDialogOwnership } from "./use-workflow-dialog-owner";

/** The surface parts of a workflow action run. Without them, the shared controls run it. */
export type TaskActionRunOptions = {
  sessionOptionsOf?: SessionOptionsOf | undefined;
  /** A surface that must keep focus, such as the non-modal details sheet, shows its own confirmations. */
  confirm?:
    | ((action: "reset_task" | "close_task", continuation?: TaskWorkflowContinuation) => void)
    | undefined;
  /** The details sheet reads the worktree, so it owns the removal. Other surfaces open the details. */
  onRemoveWorktree?: (() => void) | undefined;
};

export type TaskWorkflowActions = {
  /** Runs a declared workflow action of any surface. A failure shows its message. */
  runAction: (
    task: ResolvedTaskCard,
    action: TaskWorkflowAction,
    options?: TaskActionRunOptions,
  ) => void;
  onLaunch: LaunchTaskWorkflow;
  onApplyEvent: (taskId: string, eventId: string, launchActionIds: readonly string[]) => void;
  kanbanPendingState?: WorkflowPendingState;
  /** Open New task for the active workspace. The title starts with `initialTitle`. */
  onCreateTask: (options?: { initialTitle?: string }) => void;
  onOpenSession: (taskId: string, role: AgentRole, options?: SessionTargetOptions) => void;
  onEdit: (taskId: string, section?: EditTaskSection) => void;
  /** Open the details sheet of a task of the active workspace, on any page. */
  onOpenTaskDetails: (taskId: string) => void;
  onHumanApprove: (taskId: string, continuation?: TaskWorkflowContinuation) => void;
  onHumanRequestChanges: (taskId: string, continuation?: TaskWorkflowContinuation) => void;
  onResetImplementation: (
    taskId: string,
    options?: {
      closeDetailsAfterReset?: boolean;
      continuation?: TaskWorkflowContinuation | undefined;
    },
  ) => void;
  onResetTask: (taskId: string) => Promise<TaskCard>;
  onCloseTask: (taskId: string, options: CloseTaskOptions) => Promise<TaskCard>;
  /** Removes the worktree and local branches of a closed task. */
  onRemoveTaskWorktree: (taskId: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  /** Open the confirmation of `action` for a task of the active workspace, on any page. */
  onConfirmTaskAction: (
    taskId: string,
    action: TaskConfirmRequestAction,
    continuation?: TaskWorkflowContinuation,
  ) => void;
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
