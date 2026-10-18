import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildTasksStateValue } from "../app-state-context-values";
import {
  TaskControlContext,
  type TaskControlContextValue,
  TaskSnapshotContext,
  type TaskSnapshotContextValue,
  TasksStateContext,
  useActiveWorkspaceContext,
} from "../app-state-contexts";
import { useTaskOperations } from "../operations/tasks/use-task-operations";

export function TasksStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const {
    tasks,
    tasksAreCurrent,
    isForegroundLoadingTasks,
    isRefreshingTasksInBackground,
    isLoadingTasks,
    detectingPullRequestTaskIds,
    linkingMergedPullRequestTaskId,
    unlinkingPullRequestTaskIds,
    pendingMergedPullRequest,
    setIsLoadingTasks,
    clearTaskData,
    refreshTaskData,
    loadWorkspaceTasks,
    refreshTasks,
    refreshTasksWithOptions,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    unlinkPullRequest,
    createTask,
    updateTask,
    setTaskTargetBranch,
    deleteTask,
    closeTask,
    resetTaskImplementation,
    resetTask,
    transitionTask,
    humanApproveTask,
    humanRequestChangesTask,
  } = useTaskOperations({
    activeWorkspace,
  });

  const tasksStateValue = useMemo(
    () =>
      buildTasksStateValue({
        tasksAreCurrent,
        isForegroundLoadingTasks,
        isRefreshingTasksInBackground,
        isLoadingTasks,
        detectingPullRequestTaskIds,
        linkingMergedPullRequestTaskId,
        unlinkingPullRequestTaskIds,
        pendingMergedPullRequest,
        tasks,
        refreshTasks,
        syncPullRequests,
        linkMergedPullRequest,
        cancelLinkMergedPullRequest,
        unlinkPullRequest,
        createTask,
        updateTask,
        setTaskTargetBranch,
        deleteTask,
        closeTask,
        resetTaskImplementation,
        resetTask,
        transitionTask,
        humanApproveTask,
        humanRequestChangesTask,
      }),
    [
      createTask,
      cancelLinkMergedPullRequest,
      closeTask,
      deleteTask,
      detectingPullRequestTaskIds,
      humanApproveTask,
      humanRequestChangesTask,
      tasksAreCurrent,
      isForegroundLoadingTasks,
      isRefreshingTasksInBackground,
      isLoadingTasks,
      linkMergedPullRequest,
      linkingMergedPullRequestTaskId,
      pendingMergedPullRequest,
      unlinkingPullRequestTaskIds,
      refreshTasks,
      resetTaskImplementation,
      resetTask,
      syncPullRequests,
      unlinkPullRequest,
      tasks,
      transitionTask,
      updateTask,
      setTaskTargetBranch,
    ],
  );

  const taskSnapshotValue = useMemo<TaskSnapshotContextValue>(
    () => ({
      tasks,
      isLoadingTasks,
    }),
    [isLoadingTasks, tasks],
  );

  const taskControlValue = useMemo<TaskControlContextValue>(
    () => ({
      refreshTaskData,
      loadWorkspaceTasks,
      refreshTasksWithOptions,
      clearTaskData,
      setIsLoadingTasks,
    }),
    [
      clearTaskData,
      loadWorkspaceTasks,
      refreshTaskData,
      refreshTasksWithOptions,
      setIsLoadingTasks,
    ],
  );

  return (
    <TaskSnapshotContext.Provider value={taskSnapshotValue}>
      <TaskControlContext.Provider value={taskControlValue}>
        <TasksStateContext.Provider value={tasksStateValue}>{children}</TasksStateContext.Provider>
      </TaskControlContext.Provider>
    </TaskSnapshotContext.Provider>
  );
}
