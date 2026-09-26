import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { type ComponentProps, type ReactElement, useEffect, useRef } from "react";
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
import { TaskDetailsSheetBody } from "@/components/features/task-details/task-details-sheet-body";
import {
  TaskDetailsSheetFooter,
  type TaskDetailsSheetFooterProps,
} from "@/components/features/task-details/task-details-sheet-footer";
import { TaskDetailsSheetHeader } from "@/components/features/task-details/task-details-sheet-header";
import type { TaskDetailsSheetProps } from "@/components/features/task-details/task-details-sheet-types";
import { TaskResetConfirmDialog } from "@/components/features/task-details/task-reset-confirm-dialog";
import { useTaskDetailsSheetViewModel } from "@/components/features/task-details/use-task-details-sheet-view-model";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

export function TaskDetailsSheet(props: TaskDetailsSheetProps): ReactElement {
  const sheetContentRef = useRef<HTMLDivElement>(null);
  const workflowActions = useTaskWorkflowActions();
  const {
    activeWorkspace = null,
    task,
    allTasks,
    open,
    onOpenChange,
    onEdit = workflowActions?.onEdit,
    onDelete = workflowActions?.onDelete,
  } = props;
  const taskId = task?.id ?? null;
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

  if (!task) {
    return <TaskDetailsSheetEmptyState open={open} onOpenChange={onOpenChange} />;
  }

  const pullRequestHeaderProps = getPullRequestHeaderProps({
    task,
    onDetectPullRequest: workflowActions?.onDetectPullRequest,
    onUnlinkPullRequest: workflowActions?.onUnlinkPullRequest,
    detectingPullRequestTaskId: workflowActions?.detectingPullRequestTaskId ?? null,
    unlinkingPullRequestTaskId: workflowActions?.unlinkingPullRequestTaskId ?? null,
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
    openDeleteDialog: viewModel.openDeleteDialog,
  });

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={sheetContentRef}
        side="right"
        closeButton={null}
        visualOverlay
        className="h-full max-h-screen gap-0 p-0 sm:max-w-[680px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          sheetContentRef.current?.focus({ preventScroll: true });
        }}
      >
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
            specDoc={viewModel.specDoc}
            planDoc={viewModel.planDoc}
            qaDoc={viewModel.qaDoc}
            documentSummaries={{
              hasSpec: viewModel.hasSpecDocument,
              hasPlan: viewModel.hasPlanDocument,
              hasQa: viewModel.hasQaDocument,
              specUpdatedAt: viewModel.specSummaryUpdatedAt,
              planUpdatedAt: viewModel.planSummaryUpdatedAt,
              qaUpdatedAt: viewModel.qaSummaryUpdatedAt,
            }}
            loadSpecDocumentSection={viewModel.loadSpecDocumentSection}
            loadPlanDocumentSection={viewModel.loadPlanDocumentSection}
            loadQaDocumentSection={viewModel.loadQaDocumentSection}
          />
        </div>

        <TaskDetailsSheetFooter {...footerProps} />
      </SheetContent>

      <TaskDetailsDialogs
        viewModel={viewModel}
        showDelete={onDelete !== undefined}
        showReset={workflowActions?.onResetTask !== undefined}
        showClose={workflowActions?.onCloseTask !== undefined}
      />
    </Sheet>
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
  detectingPullRequestTaskId,
  unlinkingPullRequestTaskId,
}: {
  task: NonNullable<TaskDetailsSheetProps["task"]>;
  onDetectPullRequest: TaskWorkflowActions["onDetectPullRequest"] | undefined;
  onUnlinkPullRequest: TaskWorkflowActions["onUnlinkPullRequest"] | undefined;
  detectingPullRequestTaskId: string | null;
  unlinkingPullRequestTaskId: string | null;
}): TaskDetailsPullRequestHeaderProps {
  const props: TaskDetailsPullRequestHeaderProps = {};
  if (onDetectPullRequest && canDetectTaskPullRequest(task)) {
    props.onDetectPullRequest = () => onDetectPullRequest(task.id);
  }
  if (onUnlinkPullRequest) {
    props.onUnlinkPullRequest = () => onUnlinkPullRequest(task.id);
  }
  if (detectingPullRequestTaskId === task.id) {
    props.isDetectingPullRequest = true;
  }
  if (unlinkingPullRequestTaskId === task.id) {
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

function TaskDetailsSheetEmptyState({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: TaskDetailsSheetProps["onOpenChange"];
}): ReactElement {
  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        closeButton={null}
        visualOverlay
        className="h-full max-h-screen gap-0 p-0 sm:max-w-[680px]"
      >
        <SheetHeader>
          <SheetTitle>Task Details</SheetTitle>
          <SheetDescription>Select a task to inspect details.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
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
  openDeleteDialog: TaskDetailsViewModel["openDeleteDialog"];
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

function TaskDetailsDialogs({
  viewModel,
  showDelete,
  showReset,
  showClose,
}: {
  viewModel: TaskDetailsViewModel;
  showDelete: boolean;
  showReset: boolean;
  showClose: boolean;
}): ReactElement {
  const taskId = viewModel.taskId;
  return (
    <>
      {showDelete && taskId ? (
        <TaskDeleteConfirmDialog
          open={viewModel.isDeleteDialogOpen}
          onOpenChange={viewModel.handleDeleteDialogOpenChange}
          onCancel={viewModel.closeDeleteDialog}
          onConfirm={viewModel.confirmDelete}
          taskId={taskId}
          subtasksCount={viewModel.subtasks.length}
          impact={{
            hasSubtasks: viewModel.subtasks.length > 0,
            isLoading: viewModel.isLoadingDeleteImpact,
            isLoadingStopImpact: viewModel.isLoadingDeleteStopImpact,
            hasManagedSessionCleanup: viewModel.hasManagedDeleteSessionCleanup,
            managedWorktreeCount: viewModel.deleteManagedWorktreeCount,
            terminalCount: viewModel.deleteTerminalCount,
            activeSessionCount: viewModel.deleteActiveSessionCount,
            activeSessionCountError: viewModel.deleteActiveSessionCountError,
            error: viewModel.deleteImpactError,
          }}
          deletion={{ isPending: viewModel.isDeletePending, error: viewModel.deleteError }}
        />
      ) : null}
      {showReset && taskId ? (
        <TaskResetConfirmDialog
          open={viewModel.isResetDialogOpen}
          onOpenChange={viewModel.handleResetDialogOpenChange}
          onCancel={viewModel.closeResetDialog}
          onConfirm={viewModel.confirmReset}
          taskId={taskId}
          impact={{
            isLoading: viewModel.isLoadingResetImpact,
            isLoadingStopImpact: viewModel.isLoadingResetStopImpact,
            hasManagedSessionCleanup: viewModel.hasManagedResetSessionCleanup,
            managedWorktreeCount: viewModel.resetManagedWorktreeCount,
            terminalCount: viewModel.resetTerminalCount,
            activeSessionCount: viewModel.resetActiveSessionCount,
            activeSessionCountError: viewModel.resetActiveSessionCountError,
            error: viewModel.resetImpactError,
          }}
          reset={{ isPending: viewModel.isResetPending, error: viewModel.resetError }}
        />
      ) : null}
      {showClose && taskId ? (
        <TaskCloseConfirmDialog
          open={viewModel.isCloseDialogOpen}
          onOpenChange={viewModel.handleCloseDialogOpenChange}
          onCancel={viewModel.closeCloseDialog}
          onConfirm={viewModel.confirmClose}
          taskId={taskId}
          impact={{
            isLoading: viewModel.isLoadingCloseImpact,
            isLoadingStopImpact: viewModel.isLoadingCloseStopImpact,
            hasManagedSessionCleanup: viewModel.hasManagedCloseSessionCleanup,
            managedWorktreeCount: viewModel.closeManagedWorktreeCount,
            terminalCount: viewModel.closeTerminalCount,
            activeSessionCount: viewModel.closeActiveSessionCount,
            activeSessionCountError: viewModel.closeActiveSessionCountError,
            error: viewModel.closeImpactError,
          }}
          closing={{ isPending: viewModel.isClosePending, error: viewModel.closeError }}
        />
      ) : null}
    </>
  );
}
