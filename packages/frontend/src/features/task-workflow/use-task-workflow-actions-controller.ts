import type { TaskCard } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import {
  createGitConflictActionsModel,
  useGitConflictResolution,
} from "@/features/git-conflict-resolution";
import { useSessionStartWorkflowRunner } from "@/features/session-start";
import { gitProviderReadError as toGitProviderReadError } from "@/lib/git-provider-health";
import { buildAgentStudioHref } from "@/pages/agents/query-sync/agent-studio-navigation";
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
  useAgentOperations,
  useAgentSessionSummaries,
  useTasksState,
  useWorkspaceState,
} from "@/state/app-state-provider";
import { useAgentModelFavorites } from "@/state/mutations/use-agent-model-favorites";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import {
  buildActiveTaskSessionContextByTaskId,
  buildTaskSessionsByTaskId,
} from "@/pages/kanban/use-kanban-board-model";
import type { TaskWorkflowActions } from "./task-workflow-actions-context";

export type TaskWorkflowTaskComposerModel = {
  open: boolean;
  task: TaskCard | null;
  tasks: TaskCard[];
  onOpenChange: (open: boolean) => void;
};

export type TaskWorkflowActionsController = {
  actions: TaskWorkflowActions;
  composer: TaskWorkflowTaskComposerModel;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  taskApprovalModal: TaskApprovalModalModel | null;
  resetImplementationModal: TaskResetImplementationModalModel | null;
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
  const { startAgentSession, sendAgentMessage } = useAgentOperations();
  const sessions = useAgentSessionSummaries();
  const {
    tasks,
    refreshTasks,
    deleteTask,
    closeTask,
    syncPullRequests,
    unlinkPullRequest,
    detectingPullRequestTaskId,
    unlinkingPullRequestTaskId,
    resetTask,
    resetTaskImplementation,
    humanApproveTask,
    humanRequestChangesTask,
    setTaskTargetBranch,
  } = useTasksState();
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const openAgentStudioTabOnBackgroundSessionStart =
    settingsSnapshotQuery.data?.general.openAgentStudioTabOnBackgroundSessionStart ?? null;
  const runSessionStartWorkflow = useSessionStartWorkflowRunner({
    workspaceId: activeWorkspaceId,
    startAgentSession,
    sendAgentMessage,
  });

  const {
    humanReviewFeedbackModal,
    sessionStartModal,
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
    openAgentStudioTabOnBackgroundSessionStart,
    tasks,
    sessions,
    navigate,
    workspaceRepoPath,
    humanRequestChangesTask,
    setTaskTargetBranch,
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

  const resetFlowWorkspaceIdentity = useMemo(
    () =>
      activeWorkspaceId && workspaceRepoPath
        ? { workspaceId: activeWorkspaceId, repoPath: workspaceRepoPath }
        : null,
    [activeWorkspaceId, workspaceRepoPath],
  );
  const { resetImplementationModal, openResetImplementation } = useTaskResetFlow({
    tasks,
    workspaceIdentity: resetFlowWorkspaceIdentity,
    resetTaskImplementation,
    closeTaskDetails,
  });

  const { handleResolveGitConflict } = useGitConflictResolution({
    workspaceId: activeWorkspaceId,
    startConflictResolutionSession: async (request) =>
      startSessionIntent({
        taskId: request.taskId,
        role: request.role,
        launchActionId: "build_rebase_conflict_resolution",
        initialStartMode: request.initialStartMode,
        targetWorkingDirectory: request.targetWorkingDirectory,
        initialSourceSession: request.initialSourceSession,
        existingSessionOptions: request.existingSessionOptions,
        postStartAction: "send_message",
        message: request.message,
      }),
  });
  const handleResolveTaskGitConflict = useCallback(
    (conflict: Parameters<typeof handleResolveGitConflict>[0], taskId: string) => {
      const task = tasks.find((entry) => entry.id === taskId) ?? null;
      const builderSessions = sessions.filter(
        (entry) => entry.role === "build" && entry.taskId === taskId,
      );
      return handleResolveGitConflict(conflict, {
        taskId,
        task,
        builderSessions,
        currentViewSession: null,
        onOpenSession: (session) => {
          navigate(
            buildAgentStudioHref({
              taskId,
              sessionExternalId: session.externalSessionId,
              role: "build",
            }),
          );
        },
      });
    },
    [handleResolveGitConflict, navigate, sessions, tasks],
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

  const [composerState, setComposerState] = useState<{ open: boolean; taskId: string | null }>({
    open: false,
    taskId: null,
  });
  const composerTask =
    composerState.taskId === null
      ? null
      : (tasks.find((task) => task.id === composerState.taskId) ?? null);
  const composerOpen =
    composerState.open && (composerState.taskId === null || composerTask !== null);
  const onCreateTask = useCallback((): void => {
    setComposerState({ open: true, taskId: null });
  }, []);
  const onEdit = useCallback((taskId: string): void => {
    setComposerState({ open: true, taskId });
  }, []);
  const onComposerOpenChange = useCallback((open: boolean): void => {
    setComposerState((current) =>
      open ? { ...current, open: true } : { open: false, taskId: null },
    );
  }, []);
  const composer = useMemo<TaskWorkflowTaskComposerModel>(
    () => ({
      open: composerOpen,
      task: composerTask,
      tasks,
      onOpenChange: onComposerOpenChange,
    }),
    [composerOpen, composerTask, onComposerOpenChange, tasks],
  );

  const taskSessionsByTaskId = useMemo(() => buildTaskSessionsByTaskId(sessions), [sessions]);
  const activeTaskSessionContextByTaskId = useMemo(
    () => buildActiveTaskSessionContextByTaskId(sessions),
    [sessions],
  );

  const actions = useMemo<TaskWorkflowActions>(
    () => ({
      onCreateTask,
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onEdit,
      onHumanApprove: openTaskApproval,
      onHumanRequestChanges,
      onResetImplementation: (taskId, options) => {
        openResetImplementation(taskId, options);
      },
      onResetTask: resetTask,
      onCloseTask: closeTask,
      onDelete: (taskId, options) => deleteTask(taskId, options.deleteSubtasks),
      onDetectPullRequest: (taskId) => {
        void syncPullRequests(taskId);
      },
      onUnlinkPullRequest: (taskId) => {
        void unlinkPullRequest(taskId);
      },
      detectingPullRequestTaskId,
      unlinkingPullRequestTaskId,
      gitProviderContext: gitProvider.context,
      gitProviderReadError: toGitProviderReadError(gitProvider.error),
      registerTaskDetailsClose,
      taskSessionsByTaskId,
      activeTaskSessionContextByTaskId,
    }),
    [
      activeTaskSessionContextByTaskId,
      closeTask,
      deleteTask,
      detectingPullRequestTaskId,
      gitProvider.context,
      gitProvider.error,
      onBuild,
      onCreateTask,
      onDelegate,
      onEdit,
      onHumanRequestChanges,
      onOpenSession,
      onPlan,
      onQaOpen,
      onQaStart,
      openResetImplementation,
      openTaskApproval,
      registerTaskDetailsClose,
      resetTask,
      syncPullRequests,
      taskSessionsByTaskId,
      unlinkingPullRequestTaskId,
      unlinkPullRequest,
    ],
  );

  const gitConflictActions = taskGitConflictDialog?.conflict
    ? createGitConflictActionsModel({
        operation: taskGitConflictDialog.conflict.operation,
        isHandlingConflict: taskGitConflictDialog.isHandlingConflict,
        conflictAction: taskGitConflictDialog.conflictAction,
        onAbort: taskGitConflictDialog.onAbort,
        onAskBuilder: taskGitConflictDialog.onAskBuilder,
      })
    : null;

  return {
    actions,
    composer,
    humanReviewFeedbackModal,
    sessionStartModal,
    taskApprovalModal,
    resetImplementationModal,
    taskGitConflictDialog,
    gitConflictActions,
  };
}
