import type { AgentRole } from "@openducktor/core";
import { type ReactElement, useEffect, useRef } from "react";
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
import { useTaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
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

const EMPTY_TASK_SESSIONS: NonNullable<TaskDetailsSheetProps["taskSessions"]> = [];

export function TaskDetailsSheet(props: TaskDetailsSheetProps): ReactElement {
  const workflowActions = useTaskWorkflowActions();
  const {
    activeWorkspace = null,
    task,
    allTasks,
    open,
    onOpenChange,
    onEdit = workflowActions?.onEdit,
  } = props;
  const contextTaskSessions =
    task && workflowActions ? workflowActions.taskSessionsByTaskId.get(task.id) : undefined;
  const activeSessionContext =
    task && workflowActions
      ? workflowActions.activeTaskSessionContextByTaskId.get(task.id)
      : undefined;
  const contextHistoricalSessions = useTaskDetailsHistoricalSessions({
    repoPath: activeWorkspace?.repoPath ?? null,
    taskId: task?.id ?? null,
    enabled: workflowActions !== null && props.historicalSessions === undefined,
  });
  const taskSessions = props.taskSessions ?? contextTaskSessions ?? EMPTY_TASK_SESSIONS;
  const historicalSessions = props.historicalSessions ?? contextHistoricalSessions;
  const hasActiveSession = props.hasActiveSession ?? Boolean(activeSessionContext);
  const activeSessionRole = props.activeSessionRole ?? activeSessionContext?.role;
  const onPlan = props.onPlan ?? workflowActions?.onPlan;
  const onQaStart = props.onQaStart ?? workflowActions?.onQaStart;
  const onQaOpen = props.onQaOpen ?? workflowActions?.onQaOpen;
  const onBuild = props.onBuild ?? workflowActions?.onBuild;
  const onOpenSession = props.onOpenSession ?? workflowActions?.onOpenSession;
  const onDelegate = props.onDelegate ?? workflowActions?.onDelegate;
  const onHumanApprove = props.onHumanApprove ?? workflowActions?.onHumanApprove;
  const onHumanRequestChanges =
    props.onHumanRequestChanges ?? workflowActions?.onHumanRequestChanges;
  const onResetImplementation =
    props.onResetImplementation ?? workflowActions?.onResetImplementation;
  const onResetTask = props.onResetTask ?? workflowActions?.onResetTask;
  const onCloseTask = props.onCloseTask ?? workflowActions?.onCloseTask;
  const onDelete = props.onDelete ?? workflowActions?.onDelete;
  const onDetectPullRequest = props.onDetectPullRequest ?? workflowActions?.onDetectPullRequest;
  const onUnlinkPullRequest = props.onUnlinkPullRequest ?? workflowActions?.onUnlinkPullRequest;
  const detectingPullRequestTaskId =
    props.detectingPullRequestTaskId ?? workflowActions?.detectingPullRequestTaskId ?? null;
  const unlinkingPullRequestTaskId =
    props.unlinkingPullRequestTaskId ?? workflowActions?.unlinkingPullRequestTaskId ?? null;
  const gitProviderContext = props.gitProviderContext ?? workflowActions?.gitProviderContext;
  const gitProviderReadError =
    props.gitProviderReadError ?? workflowActions?.gitProviderReadError ?? null;
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  const registerTaskDetailsClose = workflowActions?.registerTaskDetailsClose;
  useEffect(() => {
    if (!registerTaskDetailsClose) {
      return;
    }
    return registerTaskDetailsClose(() => onOpenChangeRef.current(false));
  }, [registerTaskDetailsClose]);
  const viewModelInput = getTaskDetailsViewModelInput({
    activeWorkspace,
    task,
    allTasks,
    open,
    onOpenChange,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onOpenSession,
    onDelegate,
    onHumanApprove,
    onHumanRequestChanges,
    onResetImplementation,
    onResetTask,
    onCloseTask,
    onDelete,
    historicalSessions,
    taskSessions,
  });
  const viewModel = useTaskDetailsSheetViewModel(viewModelInput);

  const historicalSessionRoles = task ? resolveHistoricalSessionRoles(historicalSessions) : [];

  if (!task) {
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

  const canDetectPullRequestForTask = canDetectTaskPullRequest(task);
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
        side="right"
        closeButton={null}
        visualOverlay
        className="h-full max-h-screen gap-0 p-0 sm:max-w-[680px]"
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
            gitProviderContext={gitProviderContext}
            gitProviderReadError={gitProviderReadError}
            {...(onDetectPullRequest && canDetectPullRequestForTask
              ? {
                  onDetectPullRequest: () => onDetectPullRequest(task.id),
                }
              : {})}
            {...(onUnlinkPullRequest
              ? {
                  onUnlinkPullRequest: () => onUnlinkPullRequest(task.id),
                }
              : {})}
            {...(detectingPullRequestTaskId === task.id ? { isDetectingPullRequest: true } : {})}
            {...(unlinkingPullRequestTaskId === task.id ? { isUnlinkingPullRequest: true } : {})}
          />
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <TaskDetailsSheetBody
            task={task}
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
        showReset={onResetTask !== undefined}
        showClose={onCloseTask !== undefined}
      />
    </Sheet>
  );
}

type TaskDetailsViewModel = ReturnType<typeof useTaskDetailsSheetViewModel>;

function getTaskDetailsViewModelInput(args: {
  activeWorkspace: Exclude<TaskDetailsSheetProps["activeWorkspace"], undefined>;
  task: TaskDetailsSheetProps["task"];
  allTasks: TaskDetailsSheetProps["allTasks"];
  open: boolean;
  onOpenChange: TaskDetailsSheetProps["onOpenChange"];
  onPlan: TaskDetailsSheetProps["onPlan"];
  onQaStart: TaskDetailsSheetProps["onQaStart"];
  onQaOpen: TaskDetailsSheetProps["onQaOpen"];
  onBuild: TaskDetailsSheetProps["onBuild"];
  onOpenSession: TaskDetailsSheetProps["onOpenSession"];
  onDelegate: TaskDetailsSheetProps["onDelegate"];
  onHumanApprove: TaskDetailsSheetProps["onHumanApprove"];
  onHumanRequestChanges: TaskDetailsSheetProps["onHumanRequestChanges"];
  onResetImplementation: TaskDetailsSheetProps["onResetImplementation"];
  onResetTask: TaskDetailsSheetProps["onResetTask"];
  onCloseTask: TaskDetailsSheetProps["onCloseTask"];
  onDelete: TaskDetailsSheetProps["onDelete"];
  historicalSessions: NonNullable<TaskDetailsSheetProps["historicalSessions"]>;
  taskSessions: NonNullable<TaskDetailsSheetProps["taskSessions"]>;
}): Parameters<typeof useTaskDetailsSheetViewModel>[0] {
  const input: Parameters<typeof useTaskDetailsSheetViewModel>[0] = {
    activeWorkspace: args.activeWorkspace,
    task: args.task,
    allTasks: args.allTasks,
    open: args.open,
    onOpenChange: args.onOpenChange,
    onPlan: args.onPlan,
    onQaStart: args.onQaStart,
    onQaOpen: args.onQaOpen,
    onBuild: args.onBuild,
    onOpenSession: args.onOpenSession,
    onDelegate: args.onDelegate,
    onHumanApprove: args.onHumanApprove,
    onHumanRequestChanges: args.onHumanRequestChanges,
    onResetImplementation: args.onResetImplementation,
    onResetTask: args.onResetTask,
    onCloseTask: args.onCloseTask,
    onDelete: args.onDelete,
  };
  if (args.task) {
    input.resolveSessionOptionsByRole = (role: AgentRole) =>
      resolveSessionTargetOptions(args.historicalSessions, args.taskSessions, role);
  }
  return input;
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
  onDelete: TaskDetailsSheetProps["onDelete"];
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
