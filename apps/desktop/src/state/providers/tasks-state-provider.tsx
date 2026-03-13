import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildTasksStateValue } from "../app-state-context-values";
import {
  TaskControlContext,
  type TaskControlContextValue,
  TaskDataContext,
  type TaskDataContextValue,
  TasksStateContext,
  useActiveRepoContext,
  useChecksOperationsContext,
} from "../app-state-contexts";
import { useTaskOperations } from "../operations";

export function TasksStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeRepo } = useActiveRepoContext();
  const { refreshBeadsCheckForRepo } = useChecksOperationsContext();
  const {
    tasks,
    runs,
    isLoadingTasks,
    detectingPullRequestTaskId,
    unlinkingPullRequestTaskId,
    setIsLoadingTasks,
    clearTaskData,
    refreshTaskData,
    refreshTasks,
    syncPullRequests,
    unlinkPullRequest,
    createTask,
    updateTask,
    deleteTask,
    transitionTask,
    deferTask,
    resumeDeferredTask,
    humanApproveTask,
    humanRequestChangesTask,
  } = useTaskOperations({
    activeRepo,
    refreshBeadsCheckForRepo,
  });

  const tasksStateValue = useMemo(
    () =>
      buildTasksStateValue({
        isLoadingTasks,
        detectingPullRequestTaskId,
        unlinkingPullRequestTaskId,
        tasks,
        runs,
        refreshTasks,
        syncPullRequests,
        unlinkPullRequest,
        createTask,
        updateTask,
        deleteTask,
        transitionTask,
        deferTask,
        resumeDeferredTask,
        humanApproveTask,
        humanRequestChangesTask,
      }),
    [
      createTask,
      deleteTask,
      deferTask,
      detectingPullRequestTaskId,
      humanApproveTask,
      humanRequestChangesTask,
      isLoadingTasks,
      unlinkingPullRequestTaskId,
      refreshTasks,
      syncPullRequests,
      unlinkPullRequest,
      resumeDeferredTask,
      runs,
      tasks,
      transitionTask,
      updateTask,
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
      clearTaskData,
      setIsLoadingTasks,
    }),
    [clearTaskData, refreshTaskData, setIsLoadingTasks],
  );

  return (
    <TaskDataContext.Provider value={taskDataValue}>
      <TaskControlContext.Provider value={taskControlValue}>
        <TasksStateContext.Provider value={tasksStateValue}>{children}</TasksStateContext.Provider>
      </TaskControlContext.Provider>
    </TaskDataContext.Provider>
  );
}
