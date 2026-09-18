import { useQuery } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { SessionStartModal } from "@/components/features/agents/session-start-modal";
import { TaskCreateModal } from "@/components/features/task-create/task-create-modal";
import {
  createGitConflictActionsModel,
  GitConflictDialog,
  useGitConflictResolution,
} from "@/features/git-conflict-resolution";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import { useSessionStartWorkflowRunner } from "@/features/session-start";
import { buildAgentStudioHref } from "@/pages/agents/query-sync/agent-studio-navigation";
import { useAgentStudioRepoSettings } from "@/pages/agents/use-agent-studio-repo-settings";
import { TaskApprovalModal } from "@/pages/kanban/task-approval-modal";
import { TaskResetImplementationModal } from "@/pages/kanban/task-reset-implementation-modal";
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
  TaskWorkflowActionsContext,
  type TaskWorkflowActions,
} from "./task-workflow-actions-context";
import { useTaskDetailsSessionContext } from "./use-task-details-session-context";

export function TaskWorkflowActionsProvider({ children }: PropsWithChildren): ReactElement {
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

  const { resetImplementationModal, openResetImplementation } = useTaskResetFlow({
    tasks,
    resetTaskImplementation,
    closeTaskDetails: () => {},
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

  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const editTask =
    editTaskId === null ? null : (tasks.find((task) => task.id === editTaskId) ?? null);
  if (editTaskId !== null && editTask === null) {
    setEditTaskId(null);
  }
  const onEdit = useCallback((taskId: string): void => {
    setEditTaskId(taskId);
  }, []);

  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const sessionContext = useTaskDetailsSessionContext({
    repoPath: workspaceRepoPath,
    taskIds,
  });

  const actions = useMemo<TaskWorkflowActions>(
    () => ({
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onEdit,
      onHumanApprove: openTaskApproval,
      onHumanRequestChanges,
      onResetImplementation: (taskId) => {
        openResetImplementation(taskId);
      },
      onResetTask: resetTask,
      onCloseTask: closeTask,
      onDelete: (taskId, options) => deleteTask(taskId, options.deleteSubtasks),
      taskSessionsByTaskId: sessionContext.taskSessionsByTaskId,
      historicalSessionsByTaskId: sessionContext.historicalSessionsByTaskId,
      activeTaskSessionContextByTaskId: sessionContext.activeTaskSessionContextByTaskId,
    }),
    [
      closeTask,
      deleteTask,
      onBuild,
      onDelegate,
      onEdit,
      onHumanRequestChanges,
      onOpenSession,
      onPlan,
      onQaOpen,
      onQaStart,
      openResetImplementation,
      openTaskApproval,
      resetTask,
      sessionContext.activeTaskSessionContextByTaskId,
      sessionContext.historicalSessionsByTaskId,
      sessionContext.taskSessionsByTaskId,
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

  return (
    <TaskWorkflowActionsContext.Provider value={actions}>
      {children}
      {editTask ? (
        <TaskCreateModal
          open
          task={editTask}
          tasks={tasks}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setEditTaskId(null);
            }
          }}
        />
      ) : null}
      <HumanReviewFeedbackModal model={humanReviewFeedbackModal} />
      {sessionStartModal ? <SessionStartModal model={sessionStartModal} /> : null}
      <TaskApprovalModal model={taskApprovalModal} />
      <TaskResetImplementationModal model={resetImplementationModal} />
      {taskGitConflictDialog && gitConflictActions ? (
        <GitConflictDialog
          conflict={taskGitConflictDialog.conflict}
          open={taskGitConflictDialog.open}
          onOpenChange={taskGitConflictDialog.onOpenChange}
          actions={gitConflictActions}
          testId="task-workflow-git-conflict-modal"
        />
      ) : null}
    </TaskWorkflowActionsContext.Provider>
  );
}
