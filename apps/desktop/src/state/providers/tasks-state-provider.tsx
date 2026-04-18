import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildTasksStateValue } from "../app-state-context-values";
import {
  TaskControlContext,
  type TaskControlContextValue,
  TaskDataContext,
  type TaskDataContextValue,
  TasksStateContext,
  useActiveWorkspaceContext,
  useChecksOperationsContext,
} from "../app-state-contexts";
import { useTaskOperations } from "../operations";

export function TasksStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const { refreshBeadsCheckForRepo } = useChecksOperationsContext();
  const {
    tasks,
    runs,
    isForegroundLoadingTasks,
    isRefreshingTasksInBackground,
    isLoadingTasks,
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    unlinkingPullRequestTaskId,
    pendingMergedPullRequest,
    setIsLoadingTasks,
    clearTaskData,
    refreshTaskData,
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
    resetTaskImplementation,
    resetTask,
    transitionTask,
    deferTask,
    resumeDeferredTask,
    humanApproveTask,
    humanRequestChangesTask,
  } = useTaskOperations({
    activeWorkspace,
    refreshBeadsCheckForRepo,
  });

  const tasksStateValue = useMemo(
    () =>
      buildTasksStateValue({
        isForegroundLoadingTasks,
        isRefreshingTasksInBackground,
        isLoadingTasks,
        detectingPullRequestTaskId,
        linkingMergedPullRequestTaskId,
        unlinkingPullRequestTaskId,
        pendingMergedPullRequest,
        tasks,
        runs,
        refreshTasks,
        syncPullRequests,
        linkMergedPullRequest,
        cancelLinkMergedPullRequest,
        unlinkPullRequest,
        createTask,
        updateTask,
        setTaskTargetBranch,
        deleteTask,
        resetTaskImplementation,
        resetTask,
        transitionTask,
        deferTask,
        resumeDeferredTask,
        humanApproveTask,
        humanRequestChangesTask,
      }),
    [
      createTask,
      cancelLinkMergedPullRequest,
      deleteTask,
      deferTask,
      detectingPullRequestTaskId,
      humanApproveTask,
      humanRequestChangesTask,
      isForegroundLoadingTasks,
      isRefreshingTasksInBackground,
      isLoadingTasks,
      linkMergedPullRequest,
      linkingMergedPullRequestTaskId,
      pendingMergedPullRequest,
      unlinkingPullRequestTaskId,
      refreshTasks,
      resetTaskImplementation,
      resetTask,
      syncPullRequests,
      unlinkPullRequest,
      resumeDeferredTask,
      runs,
      tasks,
      transitionTask,
      updateTask,
      setTaskTargetBranch,
    ],
  );

  const taskDataValue = useMemo<TaskDataContextValue>(
    () => ({
      tasks,
      runs,
    }),
    [runs, tasks],
  );

  const taskControlValue = useMemo<TaskControlContextValue>(
    () => ({
      refreshTaskData,
      refreshTasksWithOptions,
      clearTaskData,
      setIsLoadingTasks,
    }),
    [clearTaskData, refreshTaskData, refreshTasksWithOptions, setIsLoadingTasks],
  );

  return (
    <TaskDataContext.Provider value={taskDataValue}>
      <TaskControlContext.Provider value={taskControlValue}>
        <TasksStateContext.Provider value={tasksStateValue}>{children}</TasksStateContext.Provider>
      </TaskControlContext.Provider>
    </TaskDataContext.Provider>
  );
}
