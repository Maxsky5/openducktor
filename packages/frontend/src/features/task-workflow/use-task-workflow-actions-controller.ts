import { useAgentMessageSendPolicy } from "@/lib/use-agent-message-send-policy";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { GitConflictRequestCancelled } from "@/features/git-conflict-resolution/conflict-assistance";
import { useNavigate } from "react-router";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { WorkflowPendingState } from "@/components/features/kanban/kanban-task-footer";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import {
  createGitConflictActionsModel,
  useGitConflictResolution,
} from "@/features/git-conflict-resolution";
import { buildSessionNavigationHref } from "@/features/session-navigation/session-navigation-target";
import { useSessionStartWorkflowRunner } from "@/features/session-start";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { gitProviderReadError as toGitProviderReadError } from "@/lib/git-provider-health";
import { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import type {
  TaskApprovalModalModel,
  TaskGitConflictDialogModel,
  TaskResetImplementationModalModel,
} from "@/pages/kanban/kanban-page-model-types";
import { useKanbanSessionStartFlow } from "@/pages/kanban/use-kanban-session-start-flow";
import { useTaskApprovalFlow } from "@/pages/kanban/use-task-approval-flow";
import { useTaskResetFlow } from "@/pages/kanban/use-task-reset-flow";
import {
  useAgentSessionSummaries,
  useTasksState,
  useWorkspaceState,
} from "@/state/app-state-provider";
import { useAgentModelFavorites } from "@/state/mutations/use-agent-model-favorites";
import {
  buildActiveTaskSessionContextByTaskId,
  buildTaskSessionsByTaskId,
} from "@/pages/kanban/use-kanban-board-model";
import {
  type TaskConfirmDialogHostModel,
  useTaskConfirmDialogHost,
} from "./task-confirm-dialog-host";
import type { TaskWorkflowActions } from "./task-workflow-actions-context";
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
  const sessions = useAgentSessionSummaries();
  const {
    tasks,
    refreshTasks,
    deleteTask,
    closeTask,
    syncPullRequests,
    unlinkPullRequest,
    detectingPullRequestTaskIds,
    unlinkingPullRequestTaskIds,
    resetTask,
    resetTaskImplementation,
    humanApproveTask,
  } = useTasksState();
  const runSessionStartWorkflow = useSessionStartWorkflowRunner({
    workspaceId: activeWorkspaceId,
  });

  const {
    humanReviewFeedbackModal,
    sessionStartModal,
    isSessionStarting,
    startSessionIntent,
    onPullRequestGenerate,
    onDelegate,
    onOpenSession,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanRequestChanges,
  } = useKanbanSessionStartFlow({
    activeWorkspaceId,
    branches: branches ?? [],
    favoriteState,
    repoSettings,
    tasks,
    sessions,
    navigate,
    workspaceRepoPath,
    runSessionStartWorkflow,
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

  const assertSessionCanSend = useAgentMessageSendPolicy();
  const conflictWorkspaceKey = JSON.stringify([activeWorkspaceId, workspaceRepoPath]);
  const conflictWorkspace = useRef({ key: conflictWorkspaceKey, version: 0 });
  useLayoutEffect(() => {
    if (conflictWorkspace.current.key !== conflictWorkspaceKey)
      conflictWorkspace.current = {
        key: conflictWorkspaceKey,
        version: conflictWorkspace.current.version + 1,
      };
  }, [conflictWorkspaceKey]);
  const { handleResolveGitConflict } = useGitConflictResolution({
    workspaceId: activeWorkspaceId,
    startConflictResolutionSession: async (request) => {
      const intent: Parameters<typeof startSessionIntent>[0] = {
        taskId: request.taskId,
        role: request.role,
        launchActionId: "build_rebase_conflict_resolution",
        initialStartMode: request.initialStartMode,
        targetWorkingDirectory: request.targetWorkingDirectory,
        initialSourceSession: request.initialSourceSession,
        existingSessionOptions: request.existingSessionOptions,
        postStartAction: "send_message",
        message: request.message,
      };
      if (request.assertCanSubmit) intent.assertCanSubmit = request.assertCanSubmit;
      return startSessionIntent(intent);
    },
  });
  const handleResolveTaskGitConflict = useCallback(
    (conflict: Parameters<typeof handleResolveGitConflict>[0], taskId: string) => {
      const version = conflictWorkspace.current.version;
      const assertCurrent = () => {
        if (conflictWorkspace.current.version !== version) throw new GitConflictRequestCancelled();
      };
      const task = tasks.find((entry) => entry.id === taskId) ?? null;
      const builderSessions = sessions.filter(
        (entry) => entry.role === "build" && entry.taskId === taskId,
      );
      return handleResolveGitConflict(
        conflict,
        {
          taskId,
          task,
          builderSessions,
          currentViewSession: null,
          onOpenSession: (session) => {
            if (!activeWorkspaceId) {
              throw new Error("No active workspace is selected.");
            }
            navigate(
              buildSessionNavigationHref({
                kind: "task_session",
                workspaceId: activeWorkspaceId,
                taskId,
                role: "build",
                identity: toAgentSessionIdentity(session),
              }),
            );
          },
        },
        assertSessionCanSend,
        assertCurrent,
      );
    },
    [activeWorkspaceId, handleResolveGitConflict, navigate, sessions, tasks, assertSessionCanSend],
  );

  const { taskApprovalModal, taskGitConflictDialog, openTaskApproval } = useTaskApprovalFlow({
    activeWorkspace,
    gitProviderContext: gitProvider.context,
    gitProviderContextError: gitProvider.error,
    loadGitProviderContext: gitProvider.load,
    tasks,
    requestPullRequestGeneration: onPullRequestGenerate,
    refreshTasks,
    humanApproveTask,
    openResetImplementation,
    onResolveGitConflict: handleResolveTaskGitConflict,
  });

  const { onCreateTask, onEdit, composer } = useTaskWorkflowComposer({ activeWorkspace, tasks });
  const { onOpenTaskDetails, taskDetailsSheet } = useTaskWorkflowDetailsSheet({
    activeWorkspace,
    tasks,
  });

  const onDelete = useCallback(
    (taskId: string, options: { deleteSubtasks: boolean }): Promise<void> =>
      deleteTask(taskId, options.deleteSubtasks),
    [deleteTask],
  );
  const { onConfirmTaskAction, model: taskConfirmDialog } = useTaskConfirmDialogHost({
    workspaceIdentity,
    tasks,
    onResetTask: resetTask,
    onDelete,
    // A details sheet of the task also closes, as after a confirmation in the sheet.
    onSucceeded: closeTaskDetails,
  });

  const taskSessionsByTaskId = useMemo(() => buildTaskSessionsByTaskId(sessions), [sessions]);
  const activeTaskSessionContextByTaskId = useMemo(
    () => buildActiveTaskSessionContextByTaskId(sessions),
    [sessions],
  );
  const approvingTaskId = getApprovingTaskId(taskApprovalModal);
  const requestingChangesTaskId = humanReviewFeedbackModal?.isSubmitting
    ? humanReviewFeedbackModal.taskId
    : null;
  const resettingImplementationTaskId = resetImplementationModal?.isSubmitting
    ? resetImplementationModal.taskId
    : null;
  const kanbanPendingState = useMemo<WorkflowPendingState>(
    () => ({
      isSessionStarting,
      approvingTaskId,
      requestingChangesTaskId,
      resettingImplementationTaskId,
    }),
    [isSessionStarting, approvingTaskId, requestingChangesTaskId, resettingImplementationTaskId],
  );

  const actions = useMemo<TaskWorkflowActions>(
    () => ({
      kanbanPendingState,
      onCreateTask,
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onEdit,
      onOpenTaskDetails,
      onHumanApprove: openTaskApproval,
      onHumanRequestChanges,
      onResetImplementation: (taskId, options) => {
        openResetImplementation(taskId, options);
      },
      onResetTask: resetTask,
      onCloseTask: closeTask,
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
      taskSessionsByTaskId,
      activeTaskSessionContextByTaskId,
    }),
    [
      kanbanPendingState,
      activeTaskSessionContextByTaskId,
      closeTask,
      detectingPullRequestTaskIds,
      gitProvider.context,
      gitProvider.error,
      onBuild,
      onConfirmTaskAction,
      onCreateTask,
      onDelegate,
      onDelete,
      onEdit,
      onHumanRequestChanges,
      onOpenSession,
      onOpenTaskDetails,
      onPlan,
      onQaOpen,
      onQaStart,
      openResetImplementation,
      openTaskApproval,
      registerTaskDetailsClose,
      resetTask,
      syncPullRequests,
      taskSessionsByTaskId,
      unlinkingPullRequestTaskIds,
      unlinkPullRequest,
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

function getApprovingTaskId(modal: TaskApprovalModalModel | null): string | null {
  return modal && (modal.isSubmitting || (modal.stage === "approval" && modal.isLoading))
    ? modal.taskId
    : null;
}
