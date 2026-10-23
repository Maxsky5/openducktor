import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { type ComponentProps, type ReactElement, useEffect, useRef, useState } from "react";
import type {
  ActiveTaskSessionContext,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type { TaskWorkflowAction } from "@/components/features/kanban/kanban-task-workflow";
import {
  resolveHistoricalSessionRoles,
  resolveSessionTargetOptions,
} from "@/components/features/kanban/session-target-resolution";
import { TaskCloseConfirmDialog } from "@/components/features/task-details/task-close-confirm-dialog";
import { TaskDeleteConfirmDialog } from "@/components/features/task-details/task-delete-confirm-dialog";
import { TaskResetConfirmDialog } from "@/components/features/task-details/task-reset-confirm-dialog";
import { TaskDetailsSheetBody } from "@/components/features/task-details/task-details-sheet-body";
import {
  TaskDetailsSheetFooter,
  type TaskDetailsSheetFooterProps,
} from "@/components/features/task-details/task-details-sheet-footer";
import { TaskDetailsSheetFrame } from "@/components/features/task-details/task-details-sheet-frame";
import { TaskDetailsSheetHeader } from "@/components/features/task-details/task-details-sheet-header";
import type { TaskDetailsSheetProps } from "@/components/features/task-details/task-details-sheet-types";
import { useTaskDetailsSheetViewModel } from "@/components/features/task-details/use-task-details-sheet-view-model";
import { useDialogOpen } from "@/components/ui/dialog-root";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  type TaskWorkflowActions,
  useTaskWorkflowActions,
} from "@/features/task-workflow/task-workflow-actions-context";
import { useTaskDetailsHistoricalSessions } from "@/features/task-workflow/use-task-details-historical-sessions";
import { canDetectTaskPullRequest } from "@/lib/task-display";

const DETAIL_ACTIONS: readonly TaskWorkflowAction[] = [
  "set_spec",
  "set_plan",
  "open_spec",
  "open_planner",
  "qa_start",
  "build_start",
  "open_builder",
  "open_qa",
  "human_approve",
  "human_request_changes",
  "reset_implementation",
  "reset_task",
  "close_task",
];

const EMPTY_TASK_SESSIONS: KanbanTaskSession[] = [];

export function TaskDetailsSheet({
  task,
  open,
  ...contentProps
}: TaskDetailsSheetProps): ReactElement {
  // The controller clears the task when it closes the sheet. Keep the last task for the exit.
  // Radix unmounts the closed content, so the held task runs no queries.
  const [lastTask, setLastTask] = useState(task);
  if (task && task !== lastTask) setLastTask(task);
  const shownTask = task ?? lastTask;
  return (
    <TaskDetailsSheetFrame open={open} onOpenChange={contentProps.onOpenChange}>
      {shownTask ? (
        <TaskDetailsSheetContent {...contentProps} task={shownTask} />
      ) : (
        <SheetHeader>
          <SheetTitle>Task Details</SheetTitle>
          <SheetDescription>Select a task to inspect details.</SheetDescription>
        </SheetHeader>
      )}
    </TaskDetailsSheetFrame>
  );
}

/** The task details inside `TaskDetailsSheetFrame`, with the task's confirm dialogs. */
export function TaskDetailsSheetContent(
  props: Omit<TaskDetailsSheetProps, "open" | "task"> & { task: TaskCard },
): ReactElement {
  const workflowActions = useTaskWorkflowActions();
  const {
    activeWorkspace = null,
    task,
    allTasks,
    onOpenChange,
    onEdit = workflowActions?.onEdit,
    onDelete = workflowActions?.onDelete,
  } = props;
  const open = useDialogOpen("TaskDetailsSheetContent", "TaskDetailsSheetFrame");
  const taskId = task.id;
  const contextTaskSessions = getContextTaskSessions(workflowActions, taskId);
  const activeSessionContext = getActiveTaskSessionContext(workflowActions, taskId);
  const historicalSessions = useTaskDetailsHistoricalSessions({
    repoPath: activeWorkspace?.repoPath ?? null,
    taskId,
    enabled: workflowActions !== null,
  });
  useTaskDetailsCloseRegistration(workflowActions?.registerTaskDetailsClose, taskId, onOpenChange);
  const viewModel = useTaskDetailsSheetViewModel(
    createTaskDetailsViewModelOptions({
      activeWorkspace,
      task,
      allTasks,
      open,
      onOpenChange,
      workflowActions,
      onDelete,
      historicalSessions,
      taskSessions: contextTaskSessions,
    }),
  );
  const hasActiveSession = Boolean(activeSessionContext);
  const activeSessionRole = activeSessionContext?.role;
  const pullRequestHeaderProps = getPullRequestHeaderProps({
    task,
    onDetectPullRequest: workflowActions?.onDetectPullRequest,
    onUnlinkPullRequest: workflowActions?.onUnlinkPullRequest,
    detectingPullRequestTaskIds: workflowActions?.detectingPullRequestTaskIds,
    unlinkingPullRequestTaskIds: workflowActions?.unlinkingPullRequestTaskIds,
  });
  const historicalSessionRoles = resolveTaskHistoricalSessionRoles(task, historicalSessions);
  const footerProps = getTaskDetailsFooterProps({
    task,
    onOpenChange,
    detailActions: DETAIL_ACTIONS,
    hasActiveSession,
    activeSessionRole,
    historicalSessionRoles,
    onEdit,
    onDelete,
    runWorkflowAction: viewModel.runWorkflowAction,
    openDeleteDialog: viewModel.deleteConfirm.openDialog,
  });

  return (
    <>
      <SheetTitle className="sr-only">{task.title}</SheetTitle>
      <SheetDescription className="sr-only">
        Inspect task details and workflow actions.
      </SheetDescription>
      <SheetHeader className="border-b border-border bg-card px-5 py-4">
        <TaskDetailsSheetHeader
          task={task}
          subtasksCount={viewModel.subtasks.length}
          taskLabels={viewModel.taskLabels}
          gitProviderContext={workflowActions?.gitProviderContext}
          gitProviderReadError={workflowActions?.gitProviderReadError ?? null}
          {...pullRequestHeaderProps}
        />
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <TaskDetailsSheetBody
          task={task}
          {...(activeWorkspace ? { repoPath: activeWorkspace.repoPath } : {})}
          {...(activeWorkspace ? { workspaceId: activeWorkspace.workspaceId } : {})}
          shouldRenderSubtasks={viewModel.shouldRenderSubtasks}
          subtasks={viewModel.subtasks}
        />
      </div>

      <TaskDetailsSheetFooter {...footerProps} />

      {/* Inside the sheet content, so the non-modal sheet treats focus in them as its own. */}
      {onDelete ? (
        <TaskDeleteConfirmDialog
          {...viewModel.deleteConfirm.dialog}
          taskId={task.id}
          subtasksCount={viewModel.subtasks.length}
        />
      ) : null}
      {workflowActions?.onResetTask ? (
        <TaskResetConfirmDialog {...viewModel.resetConfirm.dialog} taskId={task.id} />
      ) : null}
      {workflowActions?.onCloseTask ? (
        <TaskCloseConfirmDialog {...viewModel.closeConfirm.dialog} taskId={task.id} />
      ) : null}
    </>
  );
}

type TaskDetailsViewModel = ReturnType<typeof useTaskDetailsSheetViewModel>;

type TaskDetailsPullRequestHeaderProps = Pick<
  ComponentProps<typeof TaskDetailsSheetHeader>,
  | "onDetectPullRequest"
  | "onUnlinkPullRequest"
  | "isDetectingPullRequest"
  | "isUnlinkingPullRequest"
>;

function getContextTaskSessions(
  workflowActions: TaskWorkflowActions | null,
  taskId: string | null,
): KanbanTaskSession[] {
  if (!workflowActions || !taskId) {
    return EMPTY_TASK_SESSIONS;
  }
  return workflowActions.taskSessionsByTaskId.get(taskId) ?? EMPTY_TASK_SESSIONS;
}

function getActiveTaskSessionContext(
  workflowActions: TaskWorkflowActions | null,
  taskId: string | null,
): ActiveTaskSessionContext | undefined {
  if (!workflowActions || !taskId) {
    return undefined;
  }
  return workflowActions.activeTaskSessionContextByTaskId.get(taskId);
}

function createTaskDetailsViewModelOptions({
  activeWorkspace,
  task,
  allTasks,
  open,
  onOpenChange,
  workflowActions,
  onDelete,
  historicalSessions,
  taskSessions,
}: {
  activeWorkspace: TaskDetailsSheetProps["activeWorkspace"];
  task: TaskDetailsSheetProps["task"];
  allTasks: TaskDetailsSheetProps["allTasks"];
  open: boolean;
  onOpenChange: TaskDetailsSheetProps["onOpenChange"];
  workflowActions: TaskWorkflowActions | null;
  onDelete: TaskDetailsSheetProps["onDelete"];
  historicalSessions: AgentSessionRecord[];
  taskSessions: KanbanTaskSession[];
}): Parameters<typeof useTaskDetailsSheetViewModel>[0] {
  const options: Parameters<typeof useTaskDetailsSheetViewModel>[0] = {
    activeWorkspace: activeWorkspace ?? null,
    task,
    allTasks,
    open,
    onOpenChange,
    ...workflowActions,
    onDelete,
  };
  if (task) {
    options.resolveSessionOptionsByRole = (role: AgentRole) =>
      resolveSessionTargetOptions(historicalSessions, taskSessions, role);
  }
  return options;
}

function useTaskDetailsCloseRegistration(
  registerTaskDetailsClose: TaskWorkflowActions["registerTaskDetailsClose"] | undefined,
  taskId: string | null,
  onOpenChange: TaskDetailsSheetProps["onOpenChange"],
): void {
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  useEffect(() => {
    if (!registerTaskDetailsClose || !taskId) {
      return;
    }
    return registerTaskDetailsClose(taskId, () => onOpenChangeRef.current(false));
  }, [registerTaskDetailsClose, taskId]);
}

function getPullRequestHeaderProps({
  task,
  onDetectPullRequest,
  onUnlinkPullRequest,
  detectingPullRequestTaskIds,
  unlinkingPullRequestTaskIds,
}: {
  task: NonNullable<TaskDetailsSheetProps["task"]>;
  onDetectPullRequest: TaskWorkflowActions["onDetectPullRequest"] | undefined;
  onUnlinkPullRequest: TaskWorkflowActions["onUnlinkPullRequest"] | undefined;
  detectingPullRequestTaskIds: ReadonlySet<string> | undefined;
  unlinkingPullRequestTaskIds: ReadonlySet<string> | undefined;
}): TaskDetailsPullRequestHeaderProps {
  const props: TaskDetailsPullRequestHeaderProps = {};
  if (onDetectPullRequest && canDetectTaskPullRequest(task)) {
    props.onDetectPullRequest = () => onDetectPullRequest(task.id);
  }
  if (onUnlinkPullRequest) {
    props.onUnlinkPullRequest = () => onUnlinkPullRequest(task.id);
  }
  if (detectingPullRequestTaskIds?.has(task.id)) {
    props.isDetectingPullRequest = true;
  }
  if (unlinkingPullRequestTaskIds?.has(task.id)) {
    props.isUnlinkingPullRequest = true;
  }
  return props;
}

function resolveTaskHistoricalSessionRoles(
  task: TaskDetailsSheetProps["task"],
  historicalSessions: AgentSessionRecord[],
): AgentRole[] {
  return task ? resolveHistoricalSessionRoles(historicalSessions) : [];
}

function getTaskDetailsFooterProps({
  task,
  onOpenChange,
  detailActions,
  hasActiveSession,
  activeSessionRole,
  historicalSessionRoles,
  onEdit,
  onDelete,
  runWorkflowAction,
  openDeleteDialog,
}: {
  task: NonNullable<TaskDetailsSheetProps["task"]>;
  onOpenChange: TaskDetailsSheetProps["onOpenChange"];
  detailActions: readonly TaskWorkflowAction[];
  hasActiveSession: boolean;
  activeSessionRole: AgentRole | undefined;
  historicalSessionRoles: AgentRole[];
  onEdit: TaskDetailsSheetProps["onEdit"];
  onDelete: TaskWorkflowActions["onDelete"] | undefined;
  runWorkflowAction: TaskDetailsViewModel["runWorkflowAction"];
  openDeleteDialog: TaskDetailsViewModel["deleteConfirm"]["openDialog"];
}): TaskDetailsSheetFooterProps {
  const footerProps: TaskDetailsSheetFooterProps = {
    task,
    onOpenChange,
    includeActions: detailActions,
    hasActiveSession,
    onWorkflowAction: runWorkflowAction,
  };
  if (activeSessionRole) {
    footerProps.activeSessionRole = activeSessionRole;
  }
  if (historicalSessionRoles.length > 0) {
    footerProps.historicalSessionRoles = historicalSessionRoles;
  }
  if (onEdit) {
    footerProps.onEdit = onEdit;
  }
  if (onDelete) {
    footerProps.onDeleteSelect = openDeleteDialog;
  }
  return footerProps;
}
