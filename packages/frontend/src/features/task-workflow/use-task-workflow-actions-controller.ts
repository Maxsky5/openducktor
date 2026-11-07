import { useTaskActionTasks } from "@openducktor/frontend-core/queries/use-task-action-tasks";
import { useWorkflowEventActions } from "@openducktor/frontend-core/tasks/workflow/use-workflow-event-actions";
import type { PullRequest } from "@openducktor/contracts";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { SessionStartModalModel } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import type { WorkflowPendingState } from "@openducktor/frontend-core/tasks/board/kanban-task-footer";
import type { HumanReviewFeedbackModalModel } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import { createGitConflictActionsModel } from "@openducktor/frontend-core/git/conflicts/git-conflict-actions-model";
import { buildSessionNavigationHref } from "@/features/session-navigation/sessions-route";
import { useSessionStartWorkflowRunner } from "@openducktor/frontend-core/sessions/start/use-session-start-workflow-runner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { gitProviderReadError as toGitProviderReadError } from "@openducktor/frontend-core/review/git-provider-health";
import { openExternalUrl } from "@/lib/open-external-url";
import { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import type {
  TaskApprovalModalModel,
  TaskGitConflictDialogModel,
} from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import { useTaskApprovalFlow } from "@openducktor/frontend-core/tasks/approval/use-task-approval-flow";
import { useTaskGitConflictResolver } from "@openducktor/frontend-core/tasks/workflow/use-task-git-conflict-resolver";
import { buildWorkflowPendingState } from "@openducktor/frontend-core/tasks/workflow/task-workflow-pending-state";
import { useKanbanSessionStartFlow } from "@/pages/kanban/use-kanban-session-start-flow";
import {
  type TaskResetImplementationModalModel,
  useTaskResetFlow,
} from "@openducktor/frontend-core/tasks/workflow/use-task-reset-flow";
import { useWorkflowDialogOwner } from "@openducktor/frontend-core/tasks/workflow/use-workflow-dialog-owner";
import { useAgentSessionSummaries } from "@openducktor/frontend-core/sessions/session-store-hooks";
import { useTasksState, useWorkspaceState } from "@/state/app-state-provider";
import { useAgentModelFavorites } from "@openducktor/frontend-core/sessions/model-selection/use-agent-model-favorites";
import { useNotificationContext } from "@/state/notifications/notification-context";
import {
  deriveActiveTaskSessionContextByTaskId,
  buildTaskSessionsByTaskId,
} from "@openducktor/frontend-core/tasks/board/kanban-board-sessions";
import {
  type TaskConfirmDialogHostModel,
  useTaskConfirmDialogHost,
} from "./task-confirm-dialog-host";
import type { TaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { createTaskActionRunner } from "@openducktor/frontend-core/tasks/workflow/task-action-runner";
import {
  type TaskWorkflowTaskComposerModel,
  useTaskWorkflowComposer,
} from "./use-task-workflow-composer";
import {
  type TaskWorkflowTaskDetailsSheetModel,
  useTaskWorkflowDetailsSheet,
} from "./use-task-workflow-details-sheet";

export type TaskWorkflowActionsController = {
  actions: TaskWorkflowActions;
  workflowDialogOwner: string | null;
  composer: TaskWorkflowTaskComposerModel;
  taskDetailsSheet: TaskWorkflowTaskDetailsSheetModel;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  taskApprovalModal: TaskApprovalModalModel | null;
  resetImplementationModal: TaskResetImplementationModalModel | null;
  taskConfirmDialog: TaskConfirmDialogHostModel | null;
  taskGitConflictDialog: TaskGitConflictDialogModel | null;
  gitConflictActions: ReturnType<typeof createGitConflictActionsModel> | null;
};

export function useTaskWorkflowActionsController(): TaskWorkflowActionsController {
  const navigate = useNavigate();
  const { activeWorkspace, branches, saveAgentModelFavorites } = useWorkspaceState();
  const favoriteState = useAgentModelFavorites({ saveAgentModelFavorites });
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { gitProvider, repoSettings } = useAgentStudioRepoSettings({
    activeRepoPath: workspaceRepoPath,
    activeWorkspaceId,
  });
  const allSessions = useAgentSessionSummaries();
  const sessions = useMemo(
    () => allSessions.filter((session) => session.workspaceId === activeWorkspace?.workspaceId),
    [allSessions, activeWorkspace?.workspaceId],
  );
  const {
    tasks: boardTasks,
    deleteTask,
    closeTask,
    removeTaskWorktree,
    syncPullRequests,
    unlinkPullRequest,
    detectingPullRequestTaskIds,
    unlinkingPullRequestTaskIds,
    resetTask,
    resetTaskImplementation,
  } = useTasksState();
  const tasks = useTaskActionTasks(activeWorkspace, boardTasks);
  const { sessionStartNotifications } = useNotificationContext();
  const runSessionStartWorkflow = useSessionStartWorkflowRunner({
    workspaceId: activeWorkspaceId,
    repoPath: workspaceRepoPath,
    notifications: sessionStartNotifications,
  });

  const taskDetailsCloseByTaskIdRef = useRef(new Map<string, Set<() => void>>());
  const registerTaskDetailsClose = useCallback(
    (taskId: string, close: () => void): (() => void) => {
      const closers = taskDetailsCloseByTaskIdRef.current.get(taskId) ?? new Set<() => void>();
      closers.add(close);
      taskDetailsCloseByTaskIdRef.current.set(taskId, closers);
      return () => {
        const currentClosers = taskDetailsCloseByTaskIdRef.current.get(taskId);
        if (!currentClosers) {
          return;
        }
        currentClosers.delete(close);
        if (currentClosers.size === 0) {
          taskDetailsCloseByTaskIdRef.current.delete(taskId);
        }
      };
    },
    [],
  );
  const closeTaskDetails = useCallback((taskId: string): void => {
    const closers = taskDetailsCloseByTaskIdRef.current.get(taskId);
    if (!closers) {
      return;
    }
    for (const close of Array.from(closers)) {
      close();
    }
  }, []);

  const {
    humanReviewFeedbackModal,
    continueTaskWorkflow,
    sessionStartModal,
    isSessionStarting,
    startSessionIntent,
    onLaunch,
    onPullRequestGenerate,
    onOpenSession,
    onHumanFeedback,
  } = useKanbanSessionStartFlow({
    activeWorkspaceId,
    branches: branches ?? [],
    favoriteState,
    repoSettings,
    tasks,
    sessions,
    navigate,
    closeTaskDetails,
    workspaceRepoPath,
    runSessionStartWorkflow,
  });

  const workspaceIdentity = useMemo(
    () =>
      activeWorkspaceId && workspaceRepoPath
        ? { workspaceId: activeWorkspaceId, repoPath: workspaceRepoPath }
        : null,
    [activeWorkspaceId, workspaceRepoPath],
  );
  const { resetImplementationModal, openResetImplementation } = useTaskResetFlow({
    tasks,
    workspaceIdentity,
    resetTaskImplementation,
    closeTaskDetails,
  });

  const openBuilderSession = useCallback(
    (taskId: string, identity: AgentSessionIdentity, role: string): void => {
      if (!activeWorkspaceId) {
        throw new Error("No active workspace is selected.");
      }
      navigate(
        buildSessionNavigationHref({
          kind: "task_session",
          workspaceId: activeWorkspaceId,
          taskId,
          role,
          identity,
        }),
      );
    },
    [activeWorkspaceId, navigate],
  );
  const handleResolveTaskGitConflict = useTaskGitConflictResolver({
    activeWorkspaceId,
    workspaceRepoPath,
    tasks,
    sessions,
    startSessionIntent,
    openBuilderSession,
  });

  const { taskApprovalModal, taskGitConflictDialog, openTaskApproval } = useTaskApprovalFlow({
    activeWorkspace,
    gitProviderContext: gitProvider.context,
    gitProviderContextError: gitProvider.error,
    loadGitProviderContext: gitProvider.load,
    tasks,
    requestPullRequestGeneration: onPullRequestGenerate,
    closeTask,
    openResetImplementation,
    onResolveGitConflict: handleResolveTaskGitConflict,
    showPullRequestCreated: showPullRequestCreatedToast,
    showGitProviderContextLoadFailure: showGitProviderContextLoadFailureToast,
  });

  const { onCreateTask, onEdit, composer } = useTaskWorkflowComposer({ activeWorkspace, tasks });
  const { onOpenTaskDetails, taskDetailsSheet } = useTaskWorkflowDetailsSheet({
    activeWorkspace,
    tasks,
  });

  const onDelete = deleteTask;
  const { onConfirmTaskAction: openConfirmation, model: taskConfirmDialog } =
    useTaskConfirmDialogHost({
      workspaceIdentity,
      tasks,
      onResetTask: resetTask,
      onDelete,
      onCloseTask: closeTask,
      // A details sheet of the task also closes, as after a confirmation in the sheet.
      onSucceeded: closeTaskDetails,
    });

  const onConfirmTaskAction = useCallback<TaskWorkflowActions["onConfirmTaskAction"]>(
    (taskId, action) => openConfirmation(taskId, action),
    [openConfirmation],
  );

  const taskSessionsByTaskId = useMemo(() => buildTaskSessionsByTaskId(sessions), [sessions]);
  const activeTaskSessionContextByTaskId = useMemo(
    () => deriveActiveTaskSessionContextByTaskId(taskSessionsByTaskId),
    [taskSessionsByTaskId],
  );
  const { approvingTaskId, requestingChangesTaskId, resettingImplementationTaskId } =
    buildWorkflowPendingState({
      isSessionStarting,
      taskApprovalModal,
      humanReviewFeedbackModal,
      resetImplementationModal,
    });
  // The shared dialogs that a task details sheet opens. The composer also shows New task.
  const { workflowDialogOwner, claimWorkflowDialog } = useWorkflowDialogOwner(
    [
      composer,
      humanReviewFeedbackModal,
      sessionStartModal,
      taskApprovalModal,
      resetImplementationModal,
      taskGitConflictDialog,
    ].some((dialog) => dialog?.open === true),
  );
  const kanbanPendingState = useMemo<WorkflowPendingState>(
    () => ({
      isSessionStarting,
      approvingTaskId,
      requestingChangesTaskId,
      resettingImplementationTaskId,
    }),
    [isSessionStarting, approvingTaskId, requestingChangesTaskId, resettingImplementationTaskId],
  );

  const { onApplyEvent } = useWorkflowEventActions(
    workspaceRepoPath,
    tasks,
    onLaunch,
    activeWorkspaceId,
  );
  const runAction = useMemo(
    () =>
      createTaskActionRunner({
        onLaunch,
        onApplyEvent,
        onOpenTaskDetails,
        onOpenSession,
        onHumanApprove: (taskId) => openTaskApproval(taskId),
        onHumanFeedback,
        onConfirm: (taskId, _action, eventId, onCommitted) =>
          openResetImplementation(taskId, eventId, { closeDetailsAfterReset: true, onCommitted }),
        continueTaskWorkflow,
        showError: showWorkflowActionError,
      }),
    [
      onLaunch,
      onApplyEvent,
      onOpenTaskDetails,
      onOpenSession,
      openTaskApproval,
      onHumanFeedback,
      openResetImplementation,
      continueTaskWorkflow,
    ],
  );
  const actions = useMemo<TaskWorkflowActions>(
    () => ({
      runAction,
      kanbanPendingState,
      onLaunch,
      onCreateTask,
      onOpenSession,
      onEdit,
      onOpenTaskDetails,
      onResetTask: resetTask,
      onCloseTask: closeTask,
      onRemoveTaskWorktree: removeTaskWorktree,
      onDelete,
      onConfirmTaskAction,
      onDetectPullRequest: (taskId) => {
        void syncPullRequests(taskId);
      },
      onUnlinkPullRequest: (taskId) => {
        void unlinkPullRequest(taskId);
      },
      detectingPullRequestTaskIds,
      unlinkingPullRequestTaskIds,
      gitProviderContext: gitProvider.context,
      gitProviderReadError: toGitProviderReadError(gitProvider.error),
      registerTaskDetailsClose,
      claimWorkflowDialog,
      taskSessionsByTaskId,
      activeTaskSessionContextByTaskId,
    }),
    [
      runAction,
      kanbanPendingState,
      onLaunch,
      activeTaskSessionContextByTaskId,
      closeTask,
      detectingPullRequestTaskIds,
      gitProvider.context,
      gitProvider.error,
      onConfirmTaskAction,
      onCreateTask,
      onDelete,
      onEdit,
      onOpenSession,
      onOpenTaskDetails,
      registerTaskDetailsClose,
      removeTaskWorktree,
      resetTask,
      syncPullRequests,
      taskSessionsByTaskId,
      unlinkingPullRequestTaskIds,
      unlinkPullRequest,
      claimWorkflowDialog,
    ],
  );

  const gitConflictActions = taskGitConflictDialog?.conflict
    ? createGitConflictActionsModel({
        operation: taskGitConflictDialog.conflict.operation,
        isHandlingConflict: taskGitConflictDialog.isHandlingConflict,
        conflictAction: taskGitConflictDialog.conflictAction,
        onAbort: taskGitConflictDialog.onAbort,
        onAsk: taskGitConflictDialog.onAskBuilder,
      })
    : null;

  return {
    actions,
    workflowDialogOwner,
    composer,
    taskDetailsSheet,
    humanReviewFeedbackModal,
    sessionStartModal,
    taskApprovalModal,
    resetImplementationModal,
    taskConfirmDialog,
    taskGitConflictDialog,
    gitConflictActions,
  };
}

const showPullRequestCreatedToast = (pullRequest: PullRequest): void => {
  toast.success("Pull request created", {
    description: `PR #${pullRequest.number}`,
    action: {
      label: "Open",
      onClick: () => {
        void openExternalUrl(pullRequest.url).catch((error) => {
          toast.error("Failed to open pull request", {
            description: errorMessage(error),
          });
        });
      },
    },
  });
};

const showWorkflowActionError = (title: string, description: string): void => {
  toast.error(title, { description });
};

const showGitProviderContextLoadFailureToast = (description: string, retry: () => void): void => {
  toast.error("Failed to load Git provider context", {
    description,
    action: {
      label: "Retry",
      onClick: retry,
    },
  });
};
