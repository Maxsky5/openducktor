import type { TasksStateContextValue } from "../../types/state-slices";
import { createElement, type PropsWithChildren, type ReactElement, useMemo } from "react";
import {
  TaskControlContext,
  type TaskControlContextValue,
  TaskSnapshotContext,
  type TaskSnapshotContextValue,
  TasksStateContext,
  useActiveWorkspaceContext,
} from "../app-state-contexts";
import { useTaskOperations } from "../../tasks/operations/use-task-operations";

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
    removeTaskWorktree,
    resetTaskImplementation,
    resetTask,
    transitionTask,
    humanRequestChangesTask,
  } = useTaskOperations({
    activeWorkspace,
  });

  const tasksStateValue = useMemo(
    (): TasksStateContextValue => ({
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
      removeTaskWorktree,
      resetTaskImplementation,
      resetTask,
      transitionTask,
      humanRequestChangesTask,
    }),
    [
      createTask,
      cancelLinkMergedPullRequest,
      closeTask,
      deleteTask,
      detectingPullRequestTaskIds,
      humanRequestChangesTask,
      removeTaskWorktree,
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

  return createElement(
    TaskSnapshotContext.Provider,
    { value: taskSnapshotValue },
    createElement(
      TaskControlContext.Provider,
      { value: taskControlValue },
      createElement(TasksStateContext.Provider, { value: tasksStateValue }, children),
    ),
  );
}
